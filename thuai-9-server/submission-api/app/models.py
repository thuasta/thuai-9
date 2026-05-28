from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    game_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    submissions: Mapped[list["Submission"]] = relationship(back_populates="team")


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    error_log: Mapped[str | None] = mapped_column(Text)
    artifact_path: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    compiled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    team: Mapped["Team"] = relationship(back_populates="submissions")


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    submission_a_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id"), nullable=False)
    submission_b_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    score_a: Mapped[int | None] = mapped_column(Integer)
    score_b: Mapped[int | None] = mapped_column(Integer)
    error_log: Mapped[str | None] = mapped_column(Text)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MatchParticipant(Base):
    __tablename__ = "match_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(Integer, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    player_token: Mapped[str] = mapped_column(String(64), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer)


class SubmissionMatchLog(Base):
    """Per-match agent container stdout/stderr, captured by the evaluator after
    every run regardless of outcome. Visible only to the owning team."""

    __tablename__ = "submission_match_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(Integer, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    log: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
