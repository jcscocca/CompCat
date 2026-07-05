from __future__ import annotations

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_USER_HASH_SALT = "local-demo-salt"
DEFAULT_SESSION_SECRET = "local-dashboard-session-secret"
# Matches the guessable fallback baked into docker-compose.yml so the production
# boot validator rejects exactly what the local Compose stack ships with.
DEFAULT_ADMIN_INGEST_TOKEN = "local-admin-token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MCA_", env_file=".env", env_file_encoding="utf-8")

    environment: str = "local"
    database_url: str = "sqlite+pysqlite:///./dev-output/mobility.sqlite3"
    user_hash_salt: str = DEFAULT_USER_HASH_SALT
    session_secret: str = DEFAULT_SESSION_SECRET
    session_cookie_secure: bool | None = None
    static_dashboard_dir: str = "app/static/dashboard"
    tiles_dir: str = "app/data/tiles"
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
    socrata_arrests_dataset_id: str = "9bjs-7a7w"
    socrata_calls_dataset_id: str = "33kz-ixgy"
    socrata_app_token: str | None = Field(default=None, validation_alias="SOCRATA_APP_TOKEN")
    raw_upload_retention: bool = False
    assistant_role: str = "waypoint_analyst"
    llm_base_url: str = "http://127.0.0.1:8080/v1"
    llm_model: str = "gemma-4-26b-a4b-it-ud-q4-k-m-ctx32k"
    # Disable chain-of-thought for thinking models (e.g. Qwen) so the answer
    # lands in `content` rather than consuming the budget on reasoning_content.
    llm_disable_thinking: bool = False
    # Optional second endpoint. When both fallback values are set, the assistant
    # fails over to this node if the primary is offline or returns no content.
    llm_fallback_base_url: str = ""
    llm_fallback_model: str = ""
    llm_fallback_disable_thinking: bool = False

    geocoder_provider: str = "nominatim"
    geocoder_base_url: str = "https://nominatim.openstreetmap.org/search"
    geocoder_user_agent: str = "Waypoint/0.1"
    geocoder_contact_email: str = ""
    geocoder_cache_ttl_days: int = 30
    geocoder_max_results: int = 5
    geocoder_timeout_s: float = 5.0
    geocoder_min_interval_s: float = 1.0
    # Waypoint only has Seattle SPD data, so region-lock geocoding: bias (and by default
    # hard-restrict via bounded) results to a Seattle-metro bounding box so ambiguous names
    # like "Capitol Hill" resolve in Seattle, not the globally-dominant match (e.g. DC).
    # Nominatim viewbox format: "x1,y1,x2,y2" = lon,lat,lon,lat (W,N corner then E,S corner).
    geocoder_viewbox: str = "-122.55,47.78,-122.10,47.43"
    geocoder_bounded: bool = True

    @property
    def effective_session_cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.environment.lower() in {"prod", "production"}

    @model_validator(mode="after")
    def require_production_secret_overrides(self) -> Settings:
        if self.environment.lower() not in {"prod", "production"}:
            return self

        default_names = []
        if self.user_hash_salt == DEFAULT_USER_HASH_SALT:
            default_names.append("MCA_USER_HASH_SALT")
        if self.session_secret == DEFAULT_SESSION_SECRET:
            default_names.append("MCA_SESSION_SECRET")
        if self.admin_ingest_token == DEFAULT_ADMIN_INGEST_TOKEN:
            default_names.append("MCA_ADMIN_INGEST_TOKEN")
        if default_names:
            joined_names = ", ".join(default_names)
            raise ValueError(
                f"Production deployments must override local secret defaults: {joined_names}."
            )
        return self

    @model_validator(mode="after")
    def require_production_geocoder_contact(self) -> Settings:
        if self.environment.lower() not in {"prod", "production"}:
            return self
        if not self.geocoder_contact_email.strip():
            raise ValueError(
                "Production deployments must set MCA_GEOCODER_CONTACT_EMAIL "
                "(Nominatim requires an identifiable contact)."
            )
        return self


def get_settings() -> Settings:
    return Settings()
