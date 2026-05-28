from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Match, MatchParticipant, Submission, Team
from app.schemas import LeaderboardEntry

router = APIRouter()


@router.get("/", response_model=list[LeaderboardEntry])
async def leaderboard(db: AsyncSession = Depends(get_db)):
    teams_result = await db.execute(select(Team))
    teams = {t.id: t.name for t in teams_result.scalars().all()}

    subs_result = await db.execute(select(Submission.id, Submission.team_id))
    sub_to_team = {row[0]: row[1] for row in subs_result.all()}

    matches_result = await db.execute(
        select(Match).where(Match.status == "finished")
    )
    matches = matches_result.scalars().all()

    stats: dict[int, dict] = {
        tid: {"scores": []}
        for tid in teams
    }

    for m in matches:
        participant_result = await db.execute(
            select(MatchParticipant).where(MatchParticipant.match_id == m.id)
        )
        participants = [
            p for p in participant_result.scalars().all()
            if p.score is not None and p.team_id in stats
        ]
        if participants:
            for p in participants:
                stats[p.team_id]["scores"].append(p.score)
            continue

        # Legacy two-player rows from before match_participants existed.
        team_a = sub_to_team.get(m.submission_a_id)
        team_b = sub_to_team.get(m.submission_b_id)
        if team_a is None or team_b is None:
            continue
        if m.score_a is None or m.score_b is None:
            continue
        stats[team_a]["scores"].append(m.score_a)
        stats[team_b]["scores"].append(m.score_b)

    entries = []
    for tid, s in stats.items():
        scores = s["scores"]
        total_score = sum(scores)
        total_matches = len(scores)
        entries.append(
            LeaderboardEntry(
                team_name=teams[tid],
                total_score=total_score,
                average_score=round(total_score / total_matches, 3) if total_matches else 0,
                best_score=max(scores) if scores else None,
                total_matches=total_matches,
            )
        )
    entries.sort(key=lambda e: (-e.average_score, -e.total_score, e.team_name))
    return entries
