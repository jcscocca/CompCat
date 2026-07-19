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
    # Hidden from schema, but still reachable with the demo-identity fallback.
    response = client.post("/internal/crime/ingest/sample")
    assert response.status_code == 200
    assert "inserted_count" in response.json()
