from pydantic_settings import BaseSettings


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


settings = Settings()
