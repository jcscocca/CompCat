import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.deps import required_public_user_hash
from app.config import (
    DEFAULT_ADMIN_INGEST_TOKEN,
    DEFAULT_SESSION_SECRET,
    DEFAULT_USER_HASH_SALT,
    Settings,
)
from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster
from app.sessions import _sign, public_user_hash, session_id_from_token


def test_public_session_endpoint_sets_cookie(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post("/sessions")

    assert response.status_code == 200
    assert response.json()["session_state"] == "created"
    assert "mca_session" in response.cookies
    assert "Max-Age=86400" in response.headers["set-cookie"]


def test_public_session_cookie_can_be_marked_secure(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_SESSION_COOKIE_SECURE", "true")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post("/sessions")

    assert response.status_code == 200
    assert "Secure" in response.headers["set-cookie"]


def test_public_session_cookie_defaults_secure_in_production(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_SESSION_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("MCA_ENVIRONMENT", "production")
    monkeypatch.setenv("MCA_USER_HASH_SALT", "test-production-salt")
    monkeypatch.setenv("MCA_SESSION_SECRET", "test-production-session-secret")
    monkeypatch.setenv("MCA_GEOCODER_CONTACT_EMAIL", "ops@example.com")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post("/sessions")

    assert response.status_code == 200
    assert "Secure" in response.headers["set-cookie"]


def test_production_settings_reject_default_secret_material():
    with pytest.raises(ValidationError, match="Production deployments must override"):
        Settings(
            environment="production",
            user_hash_salt=DEFAULT_USER_HASH_SALT,
            session_secret=DEFAULT_SESSION_SECRET,
        )


def _prod_settings_overrides() -> dict[str, str]:
    """Non-default secret/contact material so only the field under test can fail."""
    return {
        "environment": "production",
        "user_hash_salt": "test-production-salt",
        "session_secret": "test-production-session-secret",
        "geocoder_contact_email": "ops@example.com",
    }


def test_production_settings_reject_default_admin_ingest_token():
    with pytest.raises(
        ValidationError, match=r"Production deployments must override.*MCA_ADMIN_INGEST_TOKEN"
    ):
        Settings(**_prod_settings_overrides(), admin_ingest_token=DEFAULT_ADMIN_INGEST_TOKEN)


def test_production_settings_allow_overridden_admin_ingest_token():
    settings = Settings(**_prod_settings_overrides(), admin_ingest_token="a-real-secret-token")
    assert settings.admin_ingest_token == "a-real-secret-token"


def test_production_settings_allow_unset_admin_ingest_token():
    # Unset token keeps admin ingest fail-closed (the route 403s), which is a safe
    # production posture — only the guessable shipped default is rejected.
    settings = Settings(**_prod_settings_overrides())
    assert settings.admin_ingest_token is None


def test_public_read_routes_reject_demo_header_without_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-ID": "demo@example.com"}

    for path in (
        "/places",
        "/dashboard/summary",
        "/exports/tableau/place-summary.csv",
        "/exports/tableau/route-alternatives.csv",
        "/exports/tableau/route-segments.csv",
        "/exports/tableau/route-context.csv",
    ):
        response = client.get(path, headers=headers)

        assert response.status_code == 401
        assert response.json()["detail"] == "Public session required"


def test_cookie_session_scopes_dashboard_data(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    first = TestClient(app)
    second = TestClient(app)

    first.post("/sessions")
    second.post("/sessions")
    first_user_hash = public_user_hash(first.cookies.get("mca_session"))
    assert first_user_hash is not None
    with get_sessionmaker()() as session:
        session.add(
            PlaceCluster(
                user_id_hash=first_user_hash,
                cluster_version="test",
                cluster_method="manual",
                centroid_latitude=47.6062,
                centroid_longitude=-122.3321,
                display_latitude=47.6062,
                display_longitude=-122.3321,
                cluster_radius_m=100,
                visit_count=5,
                total_dwell_minutes=300,
                median_dwell_minutes=60,
                inferred_place_type="unknown",
                sensitivity_class="normal",
                display_label="First session place",
                label_source="test",
            )
        )
        session.commit()

    first_response = first.get("/dashboard/summary")
    second_response = second.get("/dashboard/summary")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["totals"]["place_count"] == 1
    assert second_response.json()["totals"]["place_count"] == 0


def test_required_public_user_hash_rejects_missing_or_invalid_session():
    for token in (None, "invalid-token"):
        with pytest.raises(HTTPException) as exc_info:
            required_public_user_hash(token)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Public session required"


def test_session_id_from_token_rejects_expired_token():
    expired_payload = "expired-session:1"
    expired_token = f"{expired_payload}.{_sign(expired_payload)}"

    assert session_id_from_token(expired_token) is None
