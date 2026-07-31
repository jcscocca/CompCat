import json
from datetime import date

from app.db import get_sessionmaker
from app.main import create_app
from app.services.analysis_runs import create_analysis_run, latest_analysis_run_id


def test_latest_returns_most_recent_run(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'analysis_runs_service.sqlite3'}")
    session = get_sessionmaker()()

    first = create_analysis_run(
        session,
        user_id_hash="u1",
        radii_m=[250],
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        place_ids=["place-b", "place-a", "place-b"],
    )
    second = create_analysis_run(
        session,
        user_id_hash="u1",
        radii_m=[500],
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert first.id != second.id
    assert latest_analysis_run_id(session, "u1") == second.id
    assert json.loads(first.place_ids_json) == ["place-b", "place-a"]

    session.close()


def test_latest_is_none_without_runs(tmp_path):
    db = tmp_path / "analysis_runs_service_empty.sqlite3"
    create_app(database_url=f"sqlite+pysqlite:///{db}")
    session = get_sessionmaker()()

    assert latest_analysis_run_id(session, "nobody") is None

    session.close()
