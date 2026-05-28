from datetime import datetime
import re

from pydantic import BaseModel, field_validator


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class TeamRegister(BaseModel):
    name: str
    email: str
    password: str

    @field_validator("name")
    @classmethod
    def name_length(cls, v: str) -> str:
        v = v.strip()
        if not 2 <= len(v) <= 64:
            raise ValueError("队伍名称长度须在 2-64 字符之间")
        return v

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("邮箱格式不正确")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少 8 位")
        return v


class TeamLogin(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("邮箱格式不正确")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    game_token: str


class SubmissionOut(BaseModel):
    id: int
    language: str
    status: str
    error_log: str | None
    uploaded_at: datetime
    compiled_at: datetime | None

    model_config = {"from_attributes": True}


class MatchOut(BaseModel):
    id: int
    mode: str
    submission_a_id: int
    submission_b_id: int
    status: str
    score_a: int | None
    score_b: int | None
    scheduled_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class TriggerMatchRequest(BaseModel):
    submission_a_id: int
    submission_b_id: int


class LeaderboardEntry(BaseModel):
    team_name: str
    total_score: int
    average_score: float
    best_score: int | None
    total_matches: int


class SubmissionMatchLogEntry(BaseModel):
    match_id: int
    status: str
    score: int | None
    scheduled_at: datetime
    finished_at: datetime | None
    log: str


class SubmissionLogsOut(BaseModel):
    submission_id: int
    status: str
    compile_log: str | None
    matches: list[SubmissionMatchLogEntry]


class PlayerMapEntry(BaseModel):
    player_token: str
    submission_id: int
    team_id: int
    team_name: str


class PlayerMapOut(BaseModel):
    match_id: int | None
    status: str | None
    players: list[PlayerMapEntry]
