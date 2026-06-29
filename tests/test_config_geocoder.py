from __future__ import annotations

import pytest

from app.config import Settings


def test_local_settings_allow_empty_geocoder_contact_email():
    settings = Settings(environment="local")
    assert settings.geocoder_provider == "nominatim"
    assert settings.geocoder_contact_email == ""


def test_production_settings_require_geocoder_contact_email():
    with pytest.raises(ValueError, match="MCA_GEOCODER_CONTACT_EMAIL"):
        Settings(
            environment="production",
            user_hash_salt="prod-salt",
            session_secret="prod-secret",
            geocoder_contact_email="",
        )


def test_production_settings_accept_geocoder_contact_email():
    settings = Settings(
        environment="production",
        user_hash_salt="prod-salt",
        session_secret="prod-secret",
        geocoder_contact_email="ops@example.com",
    )
    assert settings.geocoder_contact_email == "ops@example.com"


def test_geocoder_defaults_to_bounded_seattle_viewbox():
    # Waypoint analyses Seattle SPD data only, so the geocoder is region-locked by
    # default: ambiguous names ("Capitol Hill") must resolve in Seattle, not e.g. DC.
    settings = Settings(environment="local")
    assert settings.geocoder_bounded is True
    assert settings.geocoder_viewbox  # non-empty Seattle-metro bounding box
