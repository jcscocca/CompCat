from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def _prod(**env) -> dict[str, object]:
    """Prod-like settings with every *other* production requirement already satisfied, so only
    the field under test can fail (see tests/test_public_sessions.py for the same pattern)."""
    base: dict[str, object] = {
        "environment": "production",
        "user_hash_salt": "test-production-salt",
        "session_secret": "test-production-session-secret",
        "geocoder_contact_email": "ops@example.com",
    }
    base.update(env)
    return base


def _settings(**env) -> Settings:
    return Settings(_env_file=None, **env)


@pytest.mark.parametrize(
    ("field", "env_name"),
    [
        ("llm_api_key", "MCA_LLM_API_KEY"),
        ("llm_fallback_api_key", "MCA_LLM_FALLBACK_API_KEY"),
        ("llm_third_api_key", "MCA_LLM_THIRD_API_KEY"),
        ("openai_api_key", "MCA_OPENAI_API_KEY"),
        ("anthropic_api_key", "MCA_ANTHROPIC_API_KEY"),
    ],
)
def test_hosted_key_without_rate_limiting_refuses_to_boot(field: str, env_name: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(**_prod(**{field: "sk-test-key"}))
    message = str(excinfo.value)
    assert "MCA_RATE_LIMIT_ENABLED" in message
    assert env_name in message


def test_hosted_key_boots_when_rate_limiting_is_on() -> None:
    settings = _settings(**_prod(anthropic_api_key="sk-test-key", rate_limit_enabled=True))
    assert settings.rate_limit_enabled is True
    assert settings.is_production_like is True


def test_keyless_production_boots_without_rate_limiting() -> None:
    # The LAN llama-swap path (no hosted key) is untouched by the guard.
    settings = _settings(**_prod())
    assert settings.rate_limit_enabled is False


def test_local_environment_is_never_gated() -> None:
    settings = _settings(environment="local", anthropic_api_key="sk-test-key")
    assert settings.is_production_like is False
    assert settings.rate_limit_enabled is False


def test_error_names_every_configured_key() -> None:
    with pytest.raises(ValidationError, match="MCA_LLM_API_KEY, MCA_ANTHROPIC_API_KEY"):
        _settings(**_prod(llm_api_key="sk-a", anthropic_api_key="sk-b"))


def test_blank_key_does_not_trip_the_guard() -> None:
    settings = _settings(**_prod(llm_api_key="   "))
    assert settings.rate_limit_enabled is False
