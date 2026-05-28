from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_team, require_admin
from app.models import Match, MatchParticipant, Submission, Team
from app.schemas import MatchOut, TriggerMatchRequest

router = APIRouter()


@router.get("/", response_model=list[MatchOut])
async def list_my_matches(
    team: Team = Depends(get_current_team),
    db: AsyncSession = Depends(get_db),
):
    sub_ids_result = await db.execute(
        select(Submission.id).where(Submission.team_id == team.id)
    )
    sub_ids = [r[0] for r in sub_ids_result.all()]
    if not sub_ids:
        return []

    participant_match_result = await db.execute(
        select(MatchParticipant.match_id).where(MatchParticipant.submission_id.in_(sub_ids))
    )
    participant_match_ids = [r[0] for r in participant_match_result.all()]

    result = await db.execute(
        select(Match)
        .where(
            (Match.submission_a_id.in_(sub_ids))
            | (Match.submission_b_id.in_(sub_ids))
            | (Match.id.in_(participant_match_ids))
        )
        .order_by(Match.scheduled_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.post("/admin/trigger", response_model=MatchOut, dependencies=[Depends(require_admin)])
async def trigger_match(body: TriggerMatchRequest, db: AsyncSession = Depends(get_db)):
    for sub_id in (body.submission_a_id, body.submission_b_id):
        result = await db.execute(
            select(Submission).where(Submission.id == sub_id, Submission.status == "ready")
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail=f"Submission {sub_id} not found or not ready")

    match = Match(
        mode="manual",
        submission_a_id=body.submission_a_id,
        submission_b_id=body.submission_b_id,
        status="pending",
    )
    db.add(match)
    await db.flush()
    sub_result = await db.execute(
        select(Submission).where(Submission.id.in_([body.submission_a_id, body.submission_b_id]))
    )
    submissions = list(sub_result.scalars().all())
    db.add_all([
        MatchParticipant(
            match_id=match.id,
            submission_id=sub.id,
            team_id=sub.team_id,
            player_token=f"m{match.id}s{sub.id}",
        )
        for sub in submissions
    ])
    await db.commit()
    await db.refresh(match)
    return match


@router.get("/admin/all", response_model=list[MatchOut], dependencies=[Depends(require_admin)])
async def list_all_matches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Match).order_by(Match.scheduled_at.desc()).limit(100)
    )
    return result.scalars().all()
