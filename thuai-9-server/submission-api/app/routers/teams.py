import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_token, hash_password, verify_password
from app.config import settings
from app.database import get_db
from app.models import Team
from app.schemas import TeamLogin, TeamRegister, TokenResponse

router = APIRouter()

ADMIN_EMAIL = "admin@thuai9.local"


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: TeamRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(Team).where((Team.email == body.email) | (Team.name == body.name))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="队伍名称或邮箱已被注册")

    team = Team(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        game_token=str(uuid.uuid4()),
    )
    db.add(team)
    await db.commit()
    await db.refresh(team)

    token = create_token(str(team.id), "team")
    return TokenResponse(access_token=token, game_token=team.game_token)


@router.post("/login", response_model=TokenResponse)
async def login(body: TeamLogin, db: AsyncSession = Depends(get_db)):
    # Admin login
    if body.email == ADMIN_EMAIL:
        if body.password != settings.admin_password:
            raise HTTPException(status_code=401, detail="邮箱或密码错误")
        token = create_token("0", "admin", expires_hours=8)
        return TokenResponse(access_token=token, game_token="")

    result = await db.execute(select(Team).where(Team.email == body.email))
    team = result.scalar_one_or_none()
    if not team or not verify_password(body.password, team.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    token = create_token(str(team.id), "team")
    return TokenResponse(access_token=token, game_token=team.game_token)
