import csv
from datetime import UTC, datetime
from io import StringIO

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.exports.statistical import STATISTICAL_COMPARISON_COLUMNS
from app.main import create_app
from app.models import CrimeIncident


def test_statistical_comparison_tableau_export_includes_site_pairwise_results(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"site-a-property-{index}",
                offense_start_utc=datetime(2024, 1, 1 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                nibrs_group="A",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"site-b-property-{index}",
                offense_start_utc=datetime(2024, 1, 1 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                nibrs_group="A",
                latitude=47.6205,
                longitude=-122.3493,
            )
            for index in range(28)
        ]
    )
    session.commit()
    session.close()

    comparison_response = client.post(
        "/analysis/sites/compare",
        json={
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "offense_category": "PROPERTY",
            "nibrs_group": "A",
            "options": [
                {
                    "id": "site-a",
                    "label": "Site A",
                    "latitude": 47.6116,
                    "longitude": -122.3372,
                    "radius_m": 250,
                },
                {
                    "id": "site-b",
                    "label": "Site B",
                    "latitude": 47.6205,
                    "longitude": -122.3493,
                    "radius_m": 250,
                },
            ],
        },
    )
    assert comparison_response.status_code == 200
    comparison_id = comparison_response.json()["id"]

    export_response = client.get(
        "/exports/tableau/statistical-comparisons.csv",
    )

    assert export_response.status_code == 200
    assert (
        export_response.headers["content-disposition"]
        == "attachment; filename=statistical-comparisons.csv"
    )
    reader = csv.DictReader(StringIO(export_response.text))
    assert reader.fieldnames == STATISTICAL_COMPARISON_COLUMNS
    rows = list(reader)
    assert rows
    assert rows[0]["comparison_id"] == comparison_id
    assert rows[0]["nibrs_group"] == "A"
    assert rows[0]["decision_class"] in {
        "statistically_lower",
        "not_statistically_clear",
        "insufficient_data",
        "model_warning",
    }
