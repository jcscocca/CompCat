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
    monkeypatch.setenv("MCA_OPENTRIPPLANNER_BASE_URL", "http://otp:8080/otp/gtfs/v1")
    settings = Settings()
    assert settings.routing_provider == "opentripplanner"
    assert settings.opentripplanner_base_url == "http://otp:8080/otp/gtfs/v1"


def test_routing_env_vars_are_documented():
    # The live-routing toggle must be discoverable in the docs, not only wired in code:
    # config reference (README + .env.example) and the deploy runbook (docs/DEPLOY.md,
    # which documents the analyst LLM the same way) must all name the enable vars.
    docs = {
        ".env.example": _REPO_ROOT / ".env.example",
        "README.md": _REPO_ROOT / "README.md",
        "docs/DEPLOY.md": _REPO_ROOT / "docs" / "DEPLOY.md",
    }
    for var in ("MCA_ROUTING_PROVIDER", "MCA_OPENTRIPPLANNER_BASE_URL"):
        for name, path in docs.items():
            assert var in path.read_text(), f"{var} is not documented in {name}"
