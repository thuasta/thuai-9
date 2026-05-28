from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    artifact_dir: str = "/data/artifacts"
    upload_dir: str = "/data/uploads"
    match_data_dir: str = "/tmp/matches"
    game_config_dir: str = "/game-config"
    live_server_image: str = "ghcr.io/thuasta/thuai-9-server:latest"
    live_server_container: str = "thuai9-live-server"
    live_server_url: str = "ws://thuai9-live-server:14514"
    live_server_network: str = "thuai-9-server_internal"
    live_server_data_dir: str = "/data/live-server"
    restart_live_server: bool = True

    class Config:
        env_file = ".env"


settings = Settings()
