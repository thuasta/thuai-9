import secrets

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_team, require_admin
from app.models import Match, MatchParticipant, Submission, Team
from app.schemas import MatchOut, PlayerMapEntry, PlayerMapOut, TriggerMatchRequest

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
    # player_token is the live-server auth credential — must be an unguessable
    # secret, never derivable from public ids (see evaluator/main.py arena_loop).
    db.add_all([
        MatchParticipant(
            match_id=match.id,
            submission_id=sub.id,
            team_id=sub.team_id,
            player_token=secrets.token_urlsafe(24),
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


@router.get("/current/player-map", response_model=PlayerMapOut)
async def current_player_map(response: Response, db: AsyncSession = Depends(get_db)):
    """Public read-only mapping from in-game player_id → team name for the match
    currently being played (or, if none is running, the most recently scheduled
    one). Spectators use this to label scoreboard entries with team names instead
    of "选手 N".

    Deliberately exposes only the non-secret player_id, not player_token: the
    token is the live-server auth credential and leaking it would let an outsider
    bind to the live WebSocket as that team's agent. The player_id here is the
    same 0-based index the game server assigns (it loads TOKENS in participant-id
    order and numbers players in that order), so it lines up with the playerId in
    the live GAME_STATE stream the spectator already sees."""
    # Prefer a live match; fall back to the latest scheduled so the spectator
    # UI can still show labels during the brief gap between matches. id.desc()
    # is a deterministic tie-break when several rows share a scheduled_at.
    live_result = await db.execute(
        select(Match)
        .where(Match.status.in_(["pending", "running"]))
        .order_by(Match.scheduled_at.desc(), Match.id.desc())
        .limit(1)
    )
    match = live_result.scalar_one_or_none()
    if match is None:
        latest_result = await db.execute(
            select(Match).order_by(Match.scheduled_at.desc(), Match.id.desc()).limit(1)
        )
        match = latest_result.scalar_one_or_none()

    # Short cache so crawling the public endpoint can't hammer the DB.
    response.headers["Cache-Control"] = "public, max-age=5"

    if match is None:
        return PlayerMapOut(match_id=None, status=None, players=[])

    rows = await db.execute(
        select(MatchParticipant, Team)
        .join(Team, Team.id == MatchParticipant.team_id)
        .where(MatchParticipant.match_id == match.id)
        .order_by(MatchParticipant.id)
    )
    # The game server assigns playerId in TOKENS order, which the evaluator builds
    # from participants ordered by id — so enumerate in that same order.
    players = [
        PlayerMapEntry(
            player_id=index,
            team_id=participant.team_id,
            team_name=team.name,
        )
        for index, (participant, team) in enumerate(rows.all())
    ]
    return PlayerMapOut(match_id=match.id, status=match.status, players=players)
