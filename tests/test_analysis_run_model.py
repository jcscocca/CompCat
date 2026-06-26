from datetime import date

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.db import get_sessionmaker
from app.main import create_app
from app.models import AnalysisRun, PlaceCluster, PlaceCrimeSummary


def test_summary_can_attach_to_an_analysis_run(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'analysis_run.sqlite3'}")
    session = get_sessionmaker()()

    cluster = PlaceCluster(
        user_id_hash="u1",
        cluster_version="v1",
        cluster_method="dbscan",
        centroid_latitude=47.6,
        centroid_longitude=-122.3,
        visit_count=10,
    )
    session.add(cluster)
    session.flush()

    run = AnalysisRun(
        user_id_hash="u1",
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        radii_m_json="[250]",
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
    )
    session.add(run)
    session.flush()

    summary = PlaceCrimeSummary(
        user_id_hash="u1",
        place_cluster_id=cluster.id,
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        incident_count=3,
        analysis_run_id=run.id,
    )
    session.add(summary)
    session.flush()

    assert run.id is not None
    assert summary.analysis_run_id == run.id

    session.close()


def test_analysis_run_migration_creates_table_and_column(tmp_path, monkeypatch):
    db_path = tmp_path / "analysis-run-migration.sqlite3"
    database_url = f"sqlite+pysqlite:///{db_path}"
    monkeypatch.setenv("MCA_DATABASE_URL", database_url)

    command.upgrade(Config("alembic.ini"), "head")

    engine = create_engine(database_url)
    inspector = inspect(engine)

    assert "analysis_runs" in inspector.get_table_names()

    analysis_run_columns = {col["name"] for col in inspector.get_columns("analysis_runs")}
    assert {
        "id",
        "user_id_hash",
        "analysis_start_date",
        "analysis_end_date",
        "radii_m_json",
        "offense_category",
        "offense_subcategory",
        "nibrs_group",
        "created_at",
    }.issubset(analysis_run_columns)

    summary_columns = {col["name"] for col in inspector.get_columns("place_crime_summaries")}
    assert "analysis_run_id" in summary_columns

    analysis_run_indexes = {idx["name"] for idx in inspector.get_indexes("analysis_runs")}
    assert "ix_analysis_runs_user_id_hash" in analysis_run_indexes
    assert "ix_analysis_runs_created_at" in analysis_run_indexes

    summary_indexes = {idx["name"] for idx in inspector.get_indexes("place_crime_summaries")}
    assert "ix_place_crime_summaries_analysis_run_id" in summary_indexes
