"""Migration-chain and schema guards (revision-id length, table/index creation),
plus a persistence smoke test of the statistical-comparison models."""
import json
import os
from datetime import date

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url

from alembic import command
from app.db import get_sessionmaker
from app.main import create_app
from app.models import (
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)

_PG_URL = os.environ.get("MCA_DATABASE_URL", "")


def test_alembic_revision_ids_fit_default_version_table() -> None:
    script = Config("alembic.ini")
    revisions = ScriptDirectory.from_config(script).walk_revisions()

    too_long = {
        revision.revision: revision.path
        for revision in revisions
        if len(revision.revision) > 32
    }

    assert too_long == {}


def test_statistical_comparison_models_persist_options_and_pairwise_results(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()

    comparison = StatisticalComparison(
        user_id_hash="analysis-user",
        comparison_type="site",
        geometry_type="place_buffer",
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        source_dataset="seattle_spd_crime",
        exposure_unit="square_km_days",
        decision_class="statistically_lower",
        recommendation_option_id="option-a",
        recommendation_label="Option A",
        overview_summary_text="Option A has a statistically lower reported-incident rate.",
        overview_caveat_text="This describes reported incidents.",
        full_caveat_text="Results use exposure-adjusted reported incident rates.",
    )
    session.add(comparison)
    session.flush()

    session.add(
        StatisticalComparisonOption(
            comparison_id=comparison.id,
            user_id_hash="analysis-user",
            option_id="option-a",
            option_label="Option A",
            geometry_type="place_buffer",
            radius_m=500,
            incident_count=8,
            exposure=30,
            exposure_unit="square_km_days",
            incident_rate=8 / 30,
            geometry_metadata_json=json.dumps(
                {
                    "summary_geometry": "47.6116,-122.3372;47.6205,-122.3493",
                    "radius_m": 500,
                },
            ),
        ),
    )
    session.add(
        StatisticalPairwiseResult(
            comparison_id=comparison.id,
            user_id_hash="analysis-user",
            option_a_id="option-a",
            option_a_label="Option A",
            option_b_id="option-b",
            option_b_label="Option B",
            winner_option_id="option-a",
            winner_label="Option A",
            decision_class="statistically_lower",
            method="exact_conditional_poisson",
            incident_count_a=8,
            incident_count_b=28,
            exposure_a=30,
            exposure_b=30,
            exposure_unit="square_km_days",
            rate_a=8 / 30,
            rate_b=28 / 30,
            rate_ratio=(8 / 30) / (28 / 30),
            ci_lower=0.1,
            ci_upper=0.8,
            p_value=0.01,
            adjusted_p_value=0.01,
            overdispersion_status="poisson_ok",
            minimum_data_status="met",
            caveat_text="",
        ),
    )
    session.commit()

    assert comparison.id
    assert session.get(StatisticalComparison, comparison.id).decision_class == "statistically_lower"
    option = session.scalar(
        select(StatisticalComparisonOption).where(
            StatisticalComparisonOption.comparison_id == comparison.id,
        ),
    )
    assert json.loads(option.geometry_metadata_json)["radius_m"] == 500
    session.close()


def test_statistical_alembic_migration_creates_comparison_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "statistical-migration.sqlite3"
    database_url = f"sqlite+pysqlite:///{db_path}"
    monkeypatch.setenv("MCA_DATABASE_URL", database_url)

    command.upgrade(Config("alembic.ini"), "head")

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert {
        "statistical_comparisons",
        "statistical_comparison_options",
        "statistical_pairwise_results",
    }.issubset(set(inspector.get_table_names()))

    comparison_columns = {
        column["name"] for column in inspector.get_columns("statistical_comparisons")
    }
    assert {
        "user_id_hash",
        "comparison_type",
        "geometry_type",
        "decision_class",
        "overview_summary_text",
        "overview_caveat_text",
        "full_caveat_text",
    }.issubset(comparison_columns)

    option_columns = {
        column["name"] for column in inspector.get_columns("statistical_comparison_options")
    }
    assert "geometry_metadata_json" in option_columns
    assert {"rate_ci_lower", "rate_ci_upper", "rate_ci_method"}.issubset(option_columns)

    option_fks = inspector.get_foreign_keys("statistical_comparison_options")
    pairwise_fks = inspector.get_foreign_keys("statistical_pairwise_results")
    assert any(fk["referred_table"] == "statistical_comparisons" for fk in option_fks)
    assert any(fk["referred_table"] == "statistical_comparisons" for fk in pairwise_fks)


def test_crime_filter_indexes_exist_after_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "crime-filter-indexes.sqlite3"
    database_url = f"sqlite+pysqlite:///{db_path}"
    monkeypatch.setenv("MCA_DATABASE_URL", database_url)

    command.upgrade(Config("alembic.ini"), "head")

    engine = create_engine(database_url)
    inspector = inspect(engine)
    crime_indexes = {index["name"] for index in inspector.get_indexes("crime_incidents")}

    assert {
        "ix_crime_incidents_offense_start_utc",
        "ix_crime_incidents_report_utc",
        "ix_crime_incidents_offense_category",
        "ix_crime_incidents_offense_subcategory",
        "ix_crime_incidents_nibrs_group",
        "ix_crime_incidents_latitude",
        "ix_crime_incidents_longitude",
    }.issubset(crime_indexes)


@pytest.mark.skipif(
    not _PG_URL.startswith("postgresql"),
    reason="Route-comparison cleanup FK guard runs only on Postgres (SQLite doesn't enforce FKs).",
)
def test_0012_deletes_route_comparison_children_before_parent(monkeypatch):
    """0012 must delete route-sourced comparisons' children (options + pairwise) before the
    parents — the child FKs have no ON DELETE CASCADE, so on a DB that actually holds route-era
    comparison data (the deploy host), the parent DELETE would otherwise raise a
    ForeignKeyViolation and the migration (and the container boot) would fail. Runs on a fresh
    throwaway database so it never touches real data. Non-route (place) comparisons must survive.
    """
    base = make_url(_PG_URL)
    scratch = f"mca_route_cleanup_{os.getpid()}"
    admin = base.set(database="postgres")

    def _admin_exec(sql: str) -> None:
        eng = create_engine(admin, isolation_level="AUTOCOMMIT")
        try:
            with eng.connect() as conn:
                conn.execute(text(sql))
        finally:
            eng.dispose()

    _admin_exec(
        f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        f"WHERE datname = '{scratch}' AND pid <> pg_backend_pid()"
    )
    _admin_exec(f'DROP DATABASE IF EXISTS "{scratch}"')
    _admin_exec(f'CREATE DATABASE "{scratch}"')
    scratch_url = base.set(database=scratch)

    try:
        monkeypatch.setenv("MCA_DATABASE_URL", scratch_url.render_as_string(hide_password=False))
        cfg = Config("alembic.ini")
        command.upgrade(cfg, "0011_arrest_category_backfill")

        engine = create_engine(scratch_url)
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO route_requests (id, user_id_hash, origin_label, origin_latitude, "
                "origin_longitude, origin_location_type, destination_label, destination_latitude, "
                "destination_longitude, destination_location_type, mode, privacy_level, provider, "
                "status, created_at) VALUES ('rr1','u','Origin',47.6,-122.3,'address','Dest',47.7,"
                "-122.4,'address','transit','normal','otp','complete', now())"
            ))
            # Route-sourced comparison + BOTH children (options and pairwise) — must be deleted.
            conn.execute(text(
                "INSERT INTO statistical_comparisons (id, user_id_hash, comparison_type, "
                "source_route_request_id, geometry_type, radius_m, analysis_start_date, "
                "analysis_end_date, source_dataset, exposure_unit, decision_class, "
                "overview_summary_text, overview_caveat_text, full_caveat_text, created_at) VALUES "
                "('cmp-route','u','route','rr1','corridor',250,'2024-01-01','2024-01-31',"
                "'seattle_spd_crime','square_km_days','not_clear','s','c','fc', now())"
            ))
            conn.execute(text(
                "INSERT INTO statistical_comparison_options (id, comparison_id, user_id_hash, "
                "option_id, option_label, geometry_type, radius_m, incident_count, exposure, "
                "exposure_unit, incident_rate, geometry_metadata_json, created_at) VALUES "
                "('opt-route','cmp-route','u','o1','O1','corridor',250,5,10.0,'square_km_days',0.5,"
                "'{}', now())"
            ))
            conn.execute(text(
                "INSERT INTO statistical_pairwise_results (id, comparison_id, user_id_hash, "
                "option_a_id, option_a_label, option_b_id, option_b_label, decision_class, method, "
                "incident_count_a, incident_count_b, exposure_a, exposure_b, exposure_unit, "
                "rate_a, rate_b, rate_ratio, ci_lower, ci_upper, p_value, adjusted_p_value, "
                "overdispersion_status, minimum_data_status, caveat_text, created_at) VALUES "
                "('pw-route','cmp-route','u','o1','O1','o2','O2','not_clear','m',5,7,10.0,10.0,"
                "'square_km_days',0.5,0.7,0.71,0.2,2.5,0.3,0.3,'poisson_ok','met','', now())"
            ))
            # Place comparison + child (source_route_request_id NULL) — must survive.
            conn.execute(text(
                "INSERT INTO statistical_comparisons (id, user_id_hash, comparison_type, "
                "geometry_type, radius_m, analysis_start_date, analysis_end_date, source_dataset, "
                "exposure_unit, decision_class, overview_summary_text, overview_caveat_text, "
                "full_caveat_text, created_at) VALUES ('cmp-place','u','site','place_buffer',250,"
                "'2024-01-01','2024-01-31','seattle_spd_crime','square_km_days',"
                "'statistically_lower','s','c','fc', now())"
            ))
            conn.execute(text(
                "INSERT INTO statistical_comparison_options (id, comparison_id, user_id_hash, "
                "option_id, option_label, geometry_type, radius_m, incident_count, exposure, "
                "exposure_unit, incident_rate, geometry_metadata_json, created_at) VALUES "
                "('opt-place','cmp-place','u','o1','O1','place_buffer',250,5,10.0,'square_km_days',"
                "0.5,'{}', now())"
            ))
        engine.dispose()

        # 0012 — with the bug this raises psycopg ForeignKeyViolation on the parent DELETE.
        command.upgrade(cfg, "head")

        engine = create_engine(scratch_url)
        with engine.connect() as conn:
            gone = conn.execute(text(
                "SELECT (SELECT count(*) FROM statistical_comparisons WHERE id='cmp-route') "
                "+ (SELECT count(*) FROM statistical_comparison_options WHERE id='opt-route') "
                "+ (SELECT count(*) FROM statistical_pairwise_results WHERE id='pw-route')"
            )).scalar()
            assert gone == 0
            survived = conn.execute(text(
                "SELECT (SELECT count(*) FROM statistical_comparisons WHERE id='cmp-place') "
                "+ (SELECT count(*) FROM statistical_comparison_options WHERE id='opt-place')"
            )).scalar()
            assert survived == 2
        engine.dispose()
    finally:
        _admin_exec(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname = '{scratch}' AND pid <> pg_backend_pid()"
        )
        _admin_exec(f'DROP DATABASE IF EXISTS "{scratch}"')
