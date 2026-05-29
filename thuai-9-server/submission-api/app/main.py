from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text, update

from app.database import AsyncSessionLocal, Base, engine
from app.models import Submission
from app.routers import leaderboard, matches, submissions, teams


async def ensure_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        def add_submission_columns(sync_conn) -> None:
            def _refresh_columns(table_name: str):
                inspector = inspect(sync_conn)
                return {column["name"]: column for column in inspector.get_columns(table_name)}

            def ensure_column(column_name: str, ddl: str) -> None:
                columns = set(_refresh_columns("submissions"))
                if column_name in columns:
                    return
                try:
                    sync_conn.execute(text(ddl))
                except Exception:
                    columns = set(_refresh_columns("submissions"))
                    if column_name not in columns:
                        raise

            def ensure_bigint(table_name: str, column_name: str) -> None:
                columns = _refresh_columns(table_name)
                if column_name not in columns:
                    return
                if "BIGINT" in str(columns[column_name]["type"]).upper():
                    return
                try:
                    sync_conn.execute(
                        text(f"ALTER TABLE {table_name} ALTER COLUMN {column_name} TYPE BIGINT")
                    )
                except Exception:
                    columns = _refresh_columns(table_name)
                    if column_name not in columns or "BIGINT" not in str(columns[column_name]["type"]).upper():
                        raise

            ensure_column("name", "ALTER TABLE submissions ADD COLUMN name VARCHAR(64)")
            ensure_column(
                "is_dispatched",
                "ALTER TABLE submissions ADD COLUMN is_dispatched BOOLEAN DEFAULT FALSE",
            )

            if sync_conn.dialect.name == "postgresql":
                ensure_bigint("matches", "score_a")
                ensure_bigint("matches", "score_b")
                ensure_bigint("match_participants", "score")

        await conn.run_sync(add_submission_columns)

    async with AsyncSessionLocal() as session:
        await session.execute(
            text("UPDATE submissions SET name = '代码 #' || id WHERE name IS NULL OR TRIM(name) = ''")
        )
        await session.execute(
            text("UPDATE submissions SET is_dispatched = FALSE WHERE is_dispatched IS NULL")
        )
        await session.execute(
            text("UPDATE submissions SET is_dispatched = FALSE WHERE status IS NULL OR status != 'ready'")
        )

        ready_rows = await session.execute(
            select(Submission.id, Submission.team_id)
            .where(Submission.status == "ready", Submission.is_dispatched.is_(True))
            .order_by(
                Submission.team_id,
                Submission.compiled_at.desc().nullslast(),
                Submission.uploaded_at.desc(),
                Submission.id.desc(),
            )
        )
        duplicate_ids: list[int] = []
        seen_teams: set[int] = set()
        for submission_id, team_id in ready_rows.all():
            if team_id in seen_teams:
                duplicate_ids.append(submission_id)
                continue
            seen_teams.add(team_id)

        if duplicate_ids:
            await session.execute(
                update(Submission)
                .where(Submission.id.in_(duplicate_ids))
                .values(is_dispatched=False)
            )
        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_schema()
    yield


app = FastAPI(title="THUAI-9 Submission API", lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://thuasta.org", "http://localhost", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(teams.router, tags=["teams"])
app.include_router(submissions.router, prefix="/submissions", tags=["submissions"])
app.include_router(matches.router, prefix="/matches", tags=["matches"])
app.include_router(leaderboard.router, prefix="/leaderboard", tags=["leaderboard"])


@app.get("/health")
async def health():
    return {"status": "ok"}
