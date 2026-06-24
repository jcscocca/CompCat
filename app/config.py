from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MCA_", env_file=".env", env_file_encoding="utf-8")

    environment: str = "local"
    database_url: str = "sqlite+pysqlite:///./localagent-output/mobility.sqlite3"
    user_hash_salt: str = "local-demo-salt"
    session_secret: str = "local-dashboard-session-secret"
    session_cookie_secure: bool | None = None
    static_dashboard_dir: str = "app/static/dashboard"
    public_enable_personal_uploads: bool = False
    admin_ingest_token: str | None = None
    minimum_stop_duration_minutes: int = 10
    stop_radius_m: float = 75
    cluster_radius_m: float = 100
    minimum_cluster_visits: int = 3
    minimum_cluster_total_dwell_minutes: int = 60
    crime_radii_m: list[int] = Field(default_factory=lambda: [250, 500, 1000])
    socrata_base_url: str = "https://data.seattle.gov/resource"
    socrata_dataset_id: str = "tazs-3rd5"
    socrata_app_token: str | None = Field(default=None, validation_alias="SOCRATA_APP_TOKEN")
    raw_upload_retention: bool = False

    @property
    def effective_session_cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.environment.lower() in {"prod", "production"}


def get_settings() -> Settings:
    return Settings()
