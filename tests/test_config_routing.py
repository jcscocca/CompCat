from pathlib import Path

from app.config import Settings

_REPO_ROOT = Path(__file__).resolve().parents[1]


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


def test_routing_env_vars_are_documented():
    # The live-routing toggle must be discoverable in the docs, not only wired in code:
    # MCA_ROUTING_PROVIDER / MCA_OPENTRIPPLANNER_BASE_URL were previously absent from both
    # the README config table and .env.example.
    env_example = (_REPO_ROOT / ".env.example").read_text()
    readme = (_REPO_ROOT / "README.md").read_text()
    for var in ("MCA_ROUTING_PROVIDER", "MCA_OPENTRIPPLANNER_BASE_URL"):
        assert var in env_example, f"{var} is not documented in .env.example"
        assert var in readme, f"{var} is not documented in README.md"
