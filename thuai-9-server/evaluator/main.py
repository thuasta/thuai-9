import asyncio
import logging
import os
import random
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from compiler import compile_cpp, compile_python
from config import settings
from runner import MatchAgent, run_match

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Import models after engine is set up
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Submission(Base):
    __tablename__ = "submissions"
    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, nullable=False)
    language = Column(String(8), nullable=False)
    status = Column(String(16), nullable=False)
    error_log = Column(Text)
    artifact_path = Column(Text)
    uploaded_at = Column(DateTime(timezone=True))
    compiled_at = Column(DateTime(timezone=True))


class Match(Base):
    __tablename__ = "matches"
    id = Column(Integer, primary_key=True)
    mode = Column(String(8), nullable=False)
    submission_a_id = Column(Integer, ForeignKey("submissions.id"), nullable=False)
    submission_b_id = Column(Integer, ForeignKey("submissions.id"), nullable=False)
    status = Column(String(16), nullable=False)
    score_a = Column(Integer)
    score_b = Column(Integer)
    error_log = Column(Text)
    scheduled_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    finished_at = Column(DateTime(timezone=True))


class MatchParticipant(Base):
    __tablename__ = "match_participants"
    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False)
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=False)
    team_id = Column(Integer, nullable=False)
    player_token = Column(String(64), nullable=False)
    score = Column(Integer)


class SubmissionMatchLog(Base):
    __tablename__ = "submission_match_logs"
    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False)
    submission_id = Column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    team_id = Column(Integer, nullable=False)
    log = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


os.makedirs(settings.artifact_dir, exist_ok=True)
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.match_data_dir, exist_ok=True)


async def compile_loop():
    """Pick up pending submissions and compile them."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Submission).where(Submission.status == "pending").limit(1)
                )
                sub = result.scalar_one_or_none()

                if sub is not None:
                    logger.info("Compiling submission %d (%s)", sub.id, sub.language)
                    await db.execute(
                        update(Submission)
                        .where(Submission.id == sub.id)
                        .values(status="compiling")
                    )
                    await db.commit()

                    if sub.language == "cpp":
                        success, error_log = await asyncio.get_running_loop().run_in_executor(
                            None, compile_cpp, sub.id
                        )
                    else:
                        success, error_log = await asyncio.get_running_loop().run_in_executor(
                            None, compile_python, sub.id
                        )

                    artifact_path = os.path.join(settings.artifact_dir, str(sub.id)) if success else None
                    await db.execute(
                        update(Submission)
                        .where(Submission.id == sub.id)
                        .values(
                            status="ready" if success else "failed",
                            error_log=error_log or None,
                            artifact_path=artifact_path,
                            compiled_at=datetime.now(timezone.utc),
                        )
                    )
                    await db.commit()
                    logger.info("Submission %d: %s", sub.id, "ready" if success else "failed")
        except Exception:
            logger.exception("compile_loop error")

        await asyncio.sleep(5)


async def arena_loop():
    """Schedule one live arena match containing every team with a ready submission."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                active_result = await db.execute(
                    select(Match.id)
                    .where(Match.status.in_(["pending", "running"]))
                    .limit(1)
                )
                if active_result.scalar_one_or_none() is not None:
                    await asyncio.sleep(30)
                    continue

                # Get latest ready submission per team
                result = await db.execute(
                    select(Submission)
                    .where(Submission.status == "ready")
                    .order_by(Submission.team_id, Submission.compiled_at.desc())
                )
                all_ready = result.scalars().all()

                # Deduplicate: keep latest per team
                seen_teams: set[int] = set()
                ready: list[Submission] = []
                for sub in all_ready:
                    if sub.team_id not in seen_teams:
                        seen_teams.add(sub.team_id)
                        ready.append(sub)

                if len(ready) >= 2:
                    random.shuffle(ready)
                    a, b = ready[0], ready[1]
                    match = Match(
                        mode="arena",
                        submission_a_id=a.id,
                        submission_b_id=b.id,
                        status="pending",
                    )
                    db.add(match)
                    await db.flush()
                    participants = [
                        MatchParticipant(
                            match_id=match.id,
                            submission_id=sub.id,
                            team_id=sub.team_id,
                            player_token=f"m{match.id}s{sub.id}",
                        )
                        for sub in ready
                    ]
                    db.add_all(participants)
                    await db.commit()
                    logger.info(
                        "Scheduled live arena match %d: submissions=%s",
                        match.id,
                        [sub.id for sub in ready],
                    )
        except Exception:
            logger.exception("arena_loop error")

        await asyncio.sleep(30)


async def match_runner_loop():
    """Pick up pending matches and run them."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Match).where(Match.status == "pending").limit(1)
                )
                match = result.scalar_one_or_none()

                if match is not None:
                    logger.info("Running match %d", match.id)
                    await db.execute(
                        update(Match).where(Match.id == match.id).values(status="running")
                    )
                    await db.commit()

                    participant_result = await db.execute(
                        select(MatchParticipant)
                        .where(MatchParticipant.match_id == match.id)
                        .order_by(MatchParticipant.id)
                    )
                    participant_rows = list(participant_result.scalars().all())

                    if participant_rows:
                        submission_ids = [row.submission_id for row in participant_rows]
                        sub_result = await db.execute(
                            select(Submission).where(Submission.id.in_(submission_ids))
                        )
                        submissions = {sub.id: sub for sub in sub_result.scalars().all()}
                        agents = [
                            MatchAgent(
                                submission_id=row.submission_id,
                                team_id=row.team_id,
                                language=submissions[row.submission_id].language,
                                token=row.player_token,
                            )
                            for row in participant_rows
                            if row.submission_id in submissions
                        ]
                    else:
                        # Legacy pending rows created before match_participants existed.
                        sub_result = await db.execute(
                            select(Submission).where(
                                Submission.id.in_([match.submission_a_id, match.submission_b_id])
                            )
                        )
                        submissions = {sub.id: sub for sub in sub_result.scalars().all()}
                        agents = [
                            MatchAgent(
                                submission_id=submissions[match.submission_a_id].id,
                                team_id=submissions[match.submission_a_id].team_id,
                                language=submissions[match.submission_a_id].language,
                                token=f"m{match.id}s{match.submission_a_id}",
                            ),
                            MatchAgent(
                                submission_id=submissions[match.submission_b_id].id,
                                team_id=submissions[match.submission_b_id].team_id,
                                language=submissions[match.submission_b_id].language,
                                token=f"m{match.id}s{match.submission_b_id}",
                            ),
                        ]

                    scores, error_log, agent_logs = await asyncio.get_running_loop().run_in_executor(
                        None,
                        run_match,
                        match.id,
                        agents,
                    )

                    score_a = scores.get(match.submission_a_id) if scores is not None else None
                    score_b = scores.get(match.submission_b_id) if scores is not None else None
                    if scores is not None:
                        for row in participant_rows:
                            await db.execute(
                                update(MatchParticipant)
                                .where(MatchParticipant.id == row.id)
                                .values(score=scores.get(row.submission_id))
                            )

                    # Persist per-agent container output for every participant
                    # whose container we successfully spawned, win or lose.
                    # The owning team will be able to fetch this from the API.
                    for agent in agents:
                        log_text = agent_logs.get(agent.submission_id, "")
                        db.add(SubmissionMatchLog(
                            match_id=match.id,
                            submission_id=agent.submission_id,
                            team_id=agent.team_id,
                            log=log_text,
                        ))

                    await db.execute(
                        update(Match)
                        .where(Match.id == match.id)
                        .values(
                            status="finished" if scores is not None else "error",
                            score_a=score_a,
                            score_b=score_b,
                            error_log=error_log or None,
                            finished_at=datetime.now(timezone.utc),
                        )
                    )
                    await db.commit()
                    logger.info("Match %d finished: %s", match.id, scores)
        except Exception:
            logger.exception("match_runner_loop error")

        await asyncio.sleep(10)


async def ensure_schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def main():
    logger.info("Evaluator starting")
    await ensure_schema()
    await asyncio.gather(
        compile_loop(),
        arena_loop(),
        match_runner_loop(),
    )


if __name__ == "__main__":
    asyncio.run(main())
