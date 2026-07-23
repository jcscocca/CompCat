from __future__ import annotations

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_USER_HASH_SALT = "local-demo-salt"
DEFAULT_SESSION_SECRET = "local-dashboard-session-secret"
# Compose no longer defaults to this, but the string shipped publicly for long
# enough to linger in older .env files — the production boot validator keeps
# rejecting it.
DEFAULT_ADMIN_INGEST_TOKEN = "local-admin-token"

# Only these environment names are treated as trusted local/dev/CI contexts. Anything
# else is a real deployment and must meet production-strength requirements — see
# Settings.is_production_like. Failing closed here means a deploy that forgets
# MCA_ENVIRONMENT (or sets it to "deploy"/"staging"/"demo") still gets the secret
# validators, Secure cookies, and the /internal edge block rather than silently shipping
# the known dev defaults.
LOCAL_ENVIRONMENTS = frozenset({"local", "test", "ci", "dev", "development"})


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
    # The /internal/* tier is unauthenticated by design (demo-identity fallback) and meant to
    # sit behind a trusted boundary. In a prod-like environment it is blocked at the app edge
    # (see BurstLimitMiddleware) unless this is explicitly set, since we cannot assume an
    # external reverse proxy is present to block it.
    internal_tier_enabled: bool = False
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
    # Hard ceiling on personal-upload / import request bodies, read into memory before
    # parsing. Bounds a memory-exhaustion DoS; generous enough for real location-history
    # exports. 100 MiB default.
    max_upload_bytes: int = 100 * 1024 * 1024
    assistant_role: str = "compcat_analyst"
    # Streamed Tabby narration finals + turn status events. Off = the pre-streaming
    # behavior (deterministic template finals, no status events) — a deploy-side kill
    # switch if local-model narration misbehaves.
    assistant_narration_enabled: bool = True
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

    # Bearer token for hosted OpenAI-compatible endpoints (e.g. Groq). Empty = no
    # Authorization header (the LAN llama-swap path). Fallback inherits the primary
    # key unless overridden.
    llm_api_key: str = ""
    llm_fallback_api_key: str = ""

    # Demo/public rate limiting (see docs/superpowers/specs/2026-07-10-demo-on-demand-design.md).
    # All enforcement is OFF unless rate_limit_enabled — dev and tests are unaffected.
    rate_limit_enabled: bool = False
    # Trust CF-Connecting-IP for client identity (set true only behind cloudflared;
    # otherwise the header is attacker-controlled).
    trust_proxy_headers: bool = False
    rate_limit_sessions_per_hour: int = 10
    rate_limit_assistant_per_hour: int = 20
    rate_limit_assistant_global_per_day: int = 100
    rate_limit_assistant_commands_per_hour: int = 120
    rate_limit_burst_per_minute: int = 120

    geocoder_provider: str = "nominatim"
    geocoder_base_url: str = "https://nominatim.openstreetmap.org/search"
    geocoder_user_agent: str = "CompCat/0.1"
    geocoder_contact_email: str = ""
    geocoder_cache_ttl_days: int = 30
    geocoder_max_results: int = 5
    geocoder_timeout_s: float = 5.0
    geocoder_min_interval_s: float = 1.0
    # CompCat only has Seattle SPD data, so region-lock geocoding: bias (and by default
    # hard-restrict via bounded) results to a Seattle-metro bounding box so ambiguous names
    # like "Capitol Hill" resolve in Seattle, not the globally-dominant match (e.g. DC).
    # Nominatim viewbox format: "x1,y1,x2,y2" = lon,lat,lon,lat (W,N corner then E,S corner).
    geocoder_viewbox: str = "-122.55,47.78,-122.10,47.43"
    geocoder_bounded: bool = True

    @property
    def is_production_like(self) -> bool:
        """True for any environment that is not an explicit local/dev/CI context.

        Fails closed: the secret validators, Secure-cookie default, and /internal edge
        block all key off this, so an unrecognized MCA_ENVIRONMENT is treated as a real
        deployment rather than silently inheriting dev defaults.
        """
        return self.environment.lower() not in LOCAL_ENVIRONMENTS

    @property
    def internal_tier_accessible(self) -> bool:
        return not self.is_production_like or self.internal_tier_enabled

    @property
    def effective_session_cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.is_production_like

    @property
    def effective_llm_fallback_api_key(self) -> str:
        return self.llm_fallback_api_key or self.llm_api_key

    @model_validator(mode="after")
    def require_production_secret_overrides(self) -> Settings:
        if not self.is_production_like:
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
        if not self.is_production_like:
            return self
        if not self.geocoder_contact_email.strip():
            raise ValueError(
                "Production deployments must set MCA_GEOCODER_CONTACT_EMAIL "
                "(Nominatim requires an identifiable contact)."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, parsed once. Called on every request (rate-limit middleware)
    and in hot service paths, so it is cached rather than re-reading .env and re-running the
    validators each time. Tests reset it via get_settings.cache_clear() (see tests/conftest.py)
    so a monkeypatched environment takes effect."""
    return Settings()
