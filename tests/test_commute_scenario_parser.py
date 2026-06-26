from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.parsers.commute_scenario import CommuteScenarioParser

FIXTURES = Path(__file__).parent / "fixtures"


def test_commute_scenario_parser_resolves_seattle_area_fixture():
    result = CommuteScenarioParser().parse_bytes(
        (FIXTURES / "commute_scenario.csv").read_bytes(),
        "commute_scenario.csv",
    )

    assert result.detected_schema == "public_commute_scenario_csv"
    labels = [place.display_label for place in result.direct_place_clusters]
    assert labels == ["Capitol Hill origin area", "Downtown Seattle destination area"]
    assert result.direct_place_clusters[0].source_type == "public_commute_scenario"


def test_commute_scenario_upload_creates_dashboard_places(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/imports",
        headers={"X-Demo-User-Id": "demo@example.com"},
        files={
            "file": (
                "commute_scenario.csv",
                (FIXTURES / "commute_scenario.csv").read_bytes(),
                "text/csv",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["detected_schema"] == "public_commute_scenario_csv"
    assert response.json()["place_cluster_count"] == 2
