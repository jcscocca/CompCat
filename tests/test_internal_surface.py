from fastapi.testclient import TestClient

from app.main import create_app

PUBLIC_PATHS = {
    "/sessions",
    "/places",
    "/places/bulk",
    "/dashboard/summary",
    "/dashboard/analyze",
    "/dashboard/incidents",
    "/dashboard/compare",
    "/dashboard/neighborhood",
    "/dashboard/freshness",
    "/dashboard/trends",
    "/assistant/chat",
    "/assistant/commands",
    "/exports/tableau/place-summary.csv",
    "/places/{place_id}",
}

# After internal-gating, none of these may appear in the public OpenAPI schema.
# "/imports" intentionally has no trailing slash — the route is bare POST /imports.
# Do not "fix" it to "/imports/", or the guard would stop matching that path.
FORBIDDEN_PREFIXES = ("/internal/", "/analysis/", "/imports", "/crime/")


def _schema_paths(tmp_path) -> set[str]:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    return set(schema["paths"].keys())


def test_public_paths_present_in_schema(tmp_path):
    paths = _schema_paths(tmp_path)
    missing = sorted(p for p in PUBLIC_PATHS if p not in paths)
    assert missing == [], f"expected public paths missing from schema: {missing}"


def test_legacy_and_internal_paths_absent_from_schema(tmp_path):
    paths = _schema_paths(tmp_path)
    offenders = sorted(p for p in paths if p.startswith(FORBIDDEN_PREFIXES))
    assert offenders == [], f"paths leaked into public OpenAPI schema: {offenders}"


def test_internal_endpoint_still_served(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    # Hidden from schema, but still reachable with the demo-identity fallback in local/dev.
    response = client.post("/internal/crime/ingest/sample")
    assert response.status_code == 200
    assert "inserted_count" in response.json()


def test_internal_endpoint_blocked_in_prod_like_env(tmp_path, monkeypatch):
    # The /internal/* tier is unauthenticated; in a prod-like environment it must be blocked
    # at the app edge (we can't assume an external reverse proxy is present).
    monkeypatch.setenv("MCA_ENVIRONMENT", "production")
    monkeypatch.setenv("MCA_USER_HASH_SALT", "prod-salt")
    monkeypatch.setenv("MCA_SESSION_SECRET", "prod-secret")
    monkeypatch.setenv("MCA_GEOCODER_CONTACT_EMAIL", "ops@example.com")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    assert client.post("/internal/crime/ingest/sample").status_code == 403


def test_internal_endpoint_reopenable_with_explicit_flag(tmp_path, monkeypatch):
    # An operator behind a trusted boundary can re-enable the internal tier deliberately.
    monkeypatch.setenv("MCA_ENVIRONMENT", "production")
    monkeypatch.setenv("MCA_USER_HASH_SALT", "prod-salt")
    monkeypatch.setenv("MCA_SESSION_SECRET", "prod-secret")
    monkeypatch.setenv("MCA_GEOCODER_CONTACT_EMAIL", "ops@example.com")
    monkeypatch.setenv("MCA_INTERNAL_TIER_ENABLED", "true")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    assert client.post("/internal/crime/ingest/sample").status_code == 200
