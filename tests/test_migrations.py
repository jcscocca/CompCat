"""Migration-chain and schema guards (revision-id length, table/index creation),
plus a persistence smoke test of the statistical-comparison models."""
import json
from datetime import date

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select

from alembic import command
from app.db import get_sessionmaker
from app.main import create_app
from app.models import (
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)


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
