from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Match, MatchParticipant, Submission, Team
from app.schemas import LeaderboardEntry

router = APIRouter()


@router.get("/", response_model=list[LeaderboardEntry])
async def leaderboard(db: AsyncSession = Depends(get_db)):
    submissions_result = await db.execute(
        select(Submission.id, Submission.name, Team.name)
        .join(Team, Team.id == Submission.team_id)
    )
    submissions = {
        row[0]: {
            "submission_name": row[1],
            "team_name": row[2],
        }
        for row in submissions_result.all()
    }

    stats: dict[int, list[int]] = {}
    participant_rows = await db.execute(
        select(
            MatchParticipant.match_id,
            MatchParticipant.submission_id,
            MatchParticipant.score,
        )
        .join(Match, Match.id == MatchParticipant.match_id)
        .where(
            Match.status == "finished",
            MatchParticipant.score.is_not(None),
        )
    )
    matches_with_participants: set[int] = set()
    for match_id, submission_id, score in participant_rows.all():
        if submission_id not in submissions or score is None:
            continue
        matches_with_participants.add(match_id)
        stats.setdefault(submission_id, []).append(score)

    legacy_matches_result = await db.execute(
        select(
            Match.id,
            Match.submission_a_id,
            Match.submission_b_id,
            Match.score_a,
            Match.score_b,
        )
        .where(Match.status == "finished")
    )
    for match_id, submission_a_id, submission_b_id, score_a, score_b in legacy_matches_result.all():
        if match_id in matches_with_participants:
            continue

        # Legacy two-player rows from before match_participants existed.
        if submission_a_id in submissions and score_a is not None:
            stats.setdefault(submission_a_id, []).append(score_a)
        if submission_b_id in submissions and score_b is not None:
            stats.setdefault(submission_b_id, []).append(score_b)

    entries = []
    for submission_id, scores in stats.items():
        if not scores:
            continue
        total_score = sum(scores)
        total_matches = len(scores)
        submission = submissions[submission_id]
        entries.append(
            LeaderboardEntry(
                submission_id=submission_id,
                submission_name=submission["submission_name"],
                team_name=submission["team_name"],
                total_score=total_score,
                average_score=round(total_score / total_matches, 3) if total_matches else 0,
                best_score=max(scores) if scores else None,
                total_matches=total_matches,
            )
        )
    entries.sort(
        key=lambda e: (
            -e.average_score,
            -e.total_score,
            e.submission_name,
            e.submission_id,
        )
    )
    return entries
