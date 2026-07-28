from __future__ import annotations

import logging

import pytest

from app.config import Settings
from app.main import create_app, log_posture_warnings


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
