import io
import os
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_team
from app.models import Match, MatchParticipant, Submission, SubmissionMatchLog, Team
from app.schemas import SubmissionLogsOut, SubmissionMatchLogEntry, SubmissionOut

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024       # 10 MB
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024  # 50 MB zip-bomb guard
PYTHON_ALLOWED_EXTENSIONS = {".py", ".txt", ".json", ".yaml", ".yml", ".toml", ".md"}


def _validate_zip(data: bytes, language: str) -> None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="文件不是有效的 ZIP 压缩包")

    total_uncompressed = 0
    has_main = False

    for info in zf.infolist():
        name = info.filename

        # Path traversal guard
        if ".." in name.split("/"):
            raise HTTPException(status_code=400, detail=f"ZIP 包含非法路径: {name}")

        # Symlink guard (Unix mode stored in high 16 bits of external_attr)
        unix_mode = (info.external_attr >> 16) & 0xFFFF
        if unix_mode and (unix_mode & 0xA000) == 0xA000:
            raise HTTPException(status_code=400, detail=f"ZIP 包含符号链接: {name}")

        total_uncompressed += info.file_size
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise HTTPException(status_code=400, detail="ZIP 解压后超过 50 MB 限制")

        if language == "python":
            if info.is_dir():
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in PYTHON_ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Python 提交不允许包含 {ext} 文件")
            if name == "main.py":
                has_main = True

    if language == "python" and not has_main:
        raise HTTPException(status_code=400, detail="Python 提交必须在根目录包含 main.py")


@router.post("/upload", response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
async def upload_submission(
    language: str = Form(...),
    file: UploadFile = File(...),
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    if language not in ("cpp", "python"):
        raise HTTPException(status_code=400, detail="language 必须为 cpp 或 python")

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="只接受 .zip 文件")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 10 MB 限制")

    _validate_zip(data, language)

    submission = Submission(team_id=team.id, language=language, status="pending")
    db.add(submission)
    await db.commit()
    await db.refresh(submission)

    dest_path = os.path.join(settings.upload_dir, f"{submission.id}.zip")
    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(data)

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


@router.get("/{submission_id}/logs", response_model=SubmissionLogsOut)
async def get_submission_logs(
    submission_id: int,
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    """Return compile output + the per-match agent stdout/stderr captured for
    every match this submission has participated in. Only the owning team may
    view its own logs."""
    sub_result = await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )
    submission = sub_result.scalar_one_or_none()
    if submission is None:
        raise HTTPException(status_code=404, detail="提交不存在")
    if submission.team_id != team.id:
        # 404 instead of 403 so the existence of other teams' submissions stays
        # opaque to anyone scanning IDs.
        raise HTTPException(status_code=404, detail="提交不存在")

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

    matches = [
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

    return SubmissionLogsOut(
        submission_id=submission.id,
        status=submission.status,
        compile_log=submission.error_log,
        matches=matches,
    )
