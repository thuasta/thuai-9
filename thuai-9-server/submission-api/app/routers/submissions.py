import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_team
from app.models import Match, MatchParticipant, Submission, SubmissionMatchLog, Team
from app.schemas import SubmissionLogsOut, SubmissionMatchLogEntry, SubmissionOut

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024       # 10 MB
MAX_SUBMISSION_NAME_CHARS = 64


def _normalize_submission_name(
    raw_name: str | None,
    filename: str | None,
    submission_id: int,
) -> str:
    provided_name = (raw_name or "").strip()
    if provided_name:
        if len(provided_name) > MAX_SUBMISSION_NAME_CHARS:
            raise HTTPException(
                status_code=400,
                detail=f"代码名称不能超过 {MAX_SUBMISSION_NAME_CHARS} 个字符",
            )
        return provided_name

    fallback_name = os.path.splitext(os.path.basename(filename or ""))[0].strip()
    if not fallback_name:
        fallback_name = f"代码 #{submission_id}"
    if len(fallback_name) > MAX_SUBMISSION_NAME_CHARS:
        fallback_name = fallback_name[:MAX_SUBMISSION_NAME_CHARS].rstrip()
    return fallback_name or f"代码 #{submission_id}"


async def _get_owned_submission(
    submission_id: int,
    team: Team,
    db: AsyncSession,
) -> Submission:
    sub_result = await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )
    submission = sub_result.scalar_one_or_none()
    if submission is None or submission.team_id != team.id:
        # 404 instead of 403 so the existence of other teams' submissions stays
        # opaque to anyone scanning IDs.
        raise HTTPException(status_code=404, detail="提交不存在")
    return submission


async def _get_submission_matches(
    submission_id: int,
    db: AsyncSession,
) -> list[SubmissionMatchLogEntry]:
    log_result = await db.execute(
        select(SubmissionMatchLog, Match, MatchParticipant)
        .join(Match, Match.id == SubmissionMatchLog.match_id)
        .join(
            MatchParticipant,
            (MatchParticipant.match_id == SubmissionMatchLog.match_id)
            & (MatchParticipant.submission_id == SubmissionMatchLog.submission_id),
            isouter=True,
        )
        .where(SubmissionMatchLog.submission_id == submission_id)
        .order_by(SubmissionMatchLog.created_at.desc())
        .limit(50)
    )

    return [
        SubmissionMatchLogEntry(
            match_id=match.id,
            status=match.status,
            score=participant.score if participant is not None else None,
            scheduled_at=match.scheduled_at,
            finished_at=match.finished_at,
            log=log_row.log or "",
        )
        for log_row, match, participant in log_result.all()
    ]


def _render_logs_text(
    submission: Submission,
    matches: list[SubmissionMatchLogEntry],
) -> str:
    lines = [
        f"submission_id: {submission.id}",
        f"name: {submission.name}",
        f"status: {submission.status}",
        f"is_dispatched: {submission.is_dispatched}",
        f"language: {submission.language}",
        f"uploaded_at: {submission.uploaded_at.isoformat() if submission.uploaded_at else ''}",
        f"compiled_at: {submission.compiled_at.isoformat() if submission.compiled_at else ''}",
        "",
        "[compile_log]",
        submission.error_log or "（无输出）",
    ]

    for match in matches:
        lines.extend([
            "",
            f"[match #{match.match_id}]",
            f"status: {match.status}",
            f"score: {match.score if match.score is not None else ''}",
            f"scheduled_at: {match.scheduled_at.isoformat()}",
            f"finished_at: {match.finished_at.isoformat() if match.finished_at else ''}",
            "log:",
            match.log or "（无输出）",
        ])

    return "\n".join(lines).rstrip() + "\n"


@router.post("/upload", response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
async def upload_submission(
    name: str | None = Form(None),
    file: UploadFile = File(...),
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="只接受 .zip 文件")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 10 MB 限制")

    submission = Submission(
        team_id=team.id,
        name="上传中代码",
        language="docker",
        status="pending",
        is_dispatched=False,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(submission)
    await db.flush()

    submission.name = _normalize_submission_name(name, file.filename, submission.id)
    dest_path = os.path.join(settings.upload_dir, f"{submission.id}.zip")
    os.makedirs(settings.upload_dir, exist_ok=True)
    try:
        with open(dest_path, "wb") as f:
            f.write(data)
    except OSError as exc:
        await db.rollback()
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=500, detail="保存上传文件失败") from exc

    await db.commit()
    await db.refresh(submission)

    return submission


@router.get("/", response_model=list[SubmissionOut])
async def list_submissions(
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Submission)
        .where(Submission.team_id == team.id)
        .order_by(Submission.uploaded_at.desc())
        .limit(20)
    )
    return result.scalars().all()


@router.post("/{submission_id}/dispatch", response_model=SubmissionOut)
async def dispatch_submission(
    submission_id: int,
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    submission = await _get_owned_submission(submission_id, team, db)
    if submission.status != "ready":
        raise HTTPException(status_code=400, detail="只有 ready 状态的提交可以派遣")

    await db.execute(
        update(Submission)
        .where(Submission.team_id == team.id)
        .values(is_dispatched=False)
    )
    await db.execute(
        update(Submission)
        .where(Submission.id == submission.id)
        .values(is_dispatched=True)
    )
    await db.commit()
    await db.refresh(submission)
    return submission


@router.get("/{submission_id}/logs", response_model=SubmissionLogsOut)
async def get_submission_logs(
    submission_id: int,
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    """Return compile output + the per-match agent stdout/stderr captured for
    every match this submission has participated in. Only the owning team may
    view its own logs."""
    submission = await _get_owned_submission(submission_id, team, db)
    matches = await _get_submission_matches(submission_id, db)

    return SubmissionLogsOut(
        submission_id=submission.id,
        status=submission.status,
        compile_log=submission.error_log,
        matches=matches,
    )


@router.get("/{submission_id}/logs/download", response_class=PlainTextResponse)
async def download_submission_logs(
    submission_id: int,
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    submission = await _get_owned_submission(submission_id, team, db)
    matches = await _get_submission_matches(submission_id, db)
    filename = f"submission-{submission.id}-logs.txt"
    return PlainTextResponse(
        _render_logs_text(submission, matches),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
