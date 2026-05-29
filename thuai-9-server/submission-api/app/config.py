from pydantic import field_validator
from pydantic_settings import BaseSettings

# HS256 tokens are only as strong as the signing key; a blank or trivially short
# secret lets anyone forge admin tokens, so we refuse to boot with one.
MIN_JWT_SECRET_CHARS = 16


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    admin_password: str
    upload_dir: str = "/data/uploads"
    artifact_dir: str = "/data/artifacts"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    class Config:
        env_file = ".env"

    @field_validator("jwt_secret")
    @classmethod
    def jwt_secret_strength(cls, v: str) -> str:
        if len(v.strip()) < MIN_JWT_SECRET_CHARS:
            raise ValueError(
                f"JWT_SECRET 必须至少 {MIN_JWT_SECRET_CHARS} 个字符且不能为空"
                "（生成方法：openssl rand -hex 32）"
            )
        return v


settings = Settings()
