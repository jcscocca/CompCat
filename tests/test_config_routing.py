from app.config import Settings


def test_routing_defaults_to_mock():
    settings = Settings()
    assert settings.routing_provider == "mock"
    assert settings.opentripplanner_base_url == ""
    assert settings.opentripplanner_timeout_s == 10.0


def test_routing_settings_read_env(monkeypatch):
    monkeypatch.setenv("MCA_ROUTING_PROVIDER", "opentripplanner")
    monkeypatch.setenv("MCA_OPENTRIPPLANNER_BASE_URL", "http://otp:8080/otp/routers/default")
    settings = Settings()
    assert settings.routing_provider == "opentripplanner"
    assert settings.opentripplanner_base_url == "http://otp:8080/otp/routers/default"
