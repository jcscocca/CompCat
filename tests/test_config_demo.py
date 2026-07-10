from __future__ import annotations

from app.config import Settings


def _settings(**env) -> Settings:
    return Settings(_env_file=None, **env)


def test_rate_limit_defaults_off() -> None:
    s = _settings()
    assert s.rate_limit_enabled is False
    assert s.trust_proxy_headers is False
    assert s.rate_limit_sessions_per_hour == 10
    assert s.rate_limit_assistant_per_hour == 20
    assert s.rate_limit_assistant_global_per_day == 100
    assert s.rate_limit_burst_per_minute == 120


def test_llm_api_key_defaults_empty() -> None:
    s = _settings()
    assert s.llm_api_key == ""
    assert s.llm_fallback_api_key == ""


def test_effective_fallback_api_key_inherits_primary() -> None:
    s = _settings(llm_api_key="gsk_primary")
    assert s.effective_llm_fallback_api_key == "gsk_primary"
    s2 = _settings(llm_api_key="gsk_primary", llm_fallback_api_key="gsk_other")
    assert s2.effective_llm_fallback_api_key == "gsk_other"
