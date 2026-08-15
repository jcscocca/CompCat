from __future__ import annotations

import logging

import pytest

import app.main
from app.config import Settings
from app.main import create_app, log_posture_warnings


@pytest.fixture(autouse=True)
def _enable_posture_logger():
    """Keep these assertions independent of test-suite ordering: alembic's env.py runs
    fileConfig(disable_existing_loggers=True), which silences app.main's logger for every
    later test. Same reset as tests/test_failover_llm_client.py."""
    logger = app.main.logger
    previous_disabled = logger.disabled
    previous_global_disable = logging.root.manager.disable
    logger.disabled = False
    logging.disable(logging.NOTSET)
    try:
        yield
    finally:
        logger.disabled = previous_disabled
        logging.disable(previous_global_disable)


def _prod_settings(**env) -> Settings:
    return Settings(
        _env_file=None,
        environment="production",
        user_hash_salt="test-production-salt",
        session_secret="test-production-session-secret",
        geocoder_contact_email="ops@example.com",
        **env,
    )


def test_internal_tier_warning_names_the_env_var_and_the_exposure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(_prod_settings(internal_tier_enabled=True))
    assert "MCA_INTERNAL_TIER_ENABLED" in caplog.text
    assert "internal tier is unauthenticated" in caplog.text


def test_personal_uploads_warning_names_the_env_var_and_the_exposure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(_prod_settings(public_enable_personal_uploads=True))
    assert "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS" in caplog.text
    assert "personal uploads store real location data" in caplog.text
    assert "keep OFF on shared instances" in caplog.text


def test_reasoning_model_temperature_warning_names_the_fix(
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = _prod_settings(
        llm_provider="openai_native",
        openai_api_key="test-openai-key",
        openai_model="gpt-5.6-luna",
        openai_send_temperature=True,
        rate_limit_enabled=True,
    )
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(settings)
    assert "MCA_OPENAI_SEND_TEMPERATURE=true" in caplog.text
    assert "gpt-5-family models reject" in caplog.text
    assert "MCA_OPENAI_SEND_TEMPERATURE=false" in caplog.text


def test_reasoning_model_with_temperature_disabled_is_quiet(
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = _prod_settings(
        llm_provider="openai_native",
        openai_api_key="test-openai-key",
        openai_model="gpt-5.6-luna",
        openai_send_temperature=False,
        rate_limit_enabled=True,
    )
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(settings)
    assert caplog.text == ""


def test_default_production_posture_is_quiet(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(_prod_settings())
    assert caplog.text == ""


def test_local_environment_never_warns(caplog: pytest.LogCaptureFixture) -> None:
    settings = Settings(
        _env_file=None,
        environment="local",
        internal_tier_enabled=True,
        public_enable_personal_uploads=True,
    )
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(settings)
    assert caplog.text == ""


def test_create_app_emits_the_posture_warning(
    tmp_path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_ENVIRONMENT", "production")
    monkeypatch.setenv("MCA_USER_HASH_SALT", "test-production-salt")
    monkeypatch.setenv("MCA_SESSION_SECRET", "test-production-session-secret")
    monkeypatch.setenv("MCA_GEOCODER_CONTACT_EMAIL", "ops@example.com")
    monkeypatch.setenv("MCA_INTERNAL_TIER_ENABLED", "true")
    with caplog.at_level(logging.WARNING, logger="app.main"):
        create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    assert "internal tier is unauthenticated" in caplog.text
