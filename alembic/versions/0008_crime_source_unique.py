"""crime source composite unique

Revision ID: 0008_crime_source_unique
Revises: 0007_geocode_cache
Create Date: 2026-06-29 21:29:38.547580
"""
from __future__ import annotations

from alembic import op

revision = "0008_crime_source_unique"
down_revision = "0007_geocode_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_crime_incidents_source_dataset", "crime_incidents", ["source_dataset"]
    )
    # Composite uniqueness is created per-backend. CREATE UNIQUE INDEX is portable, so SQLite
    # uses it — but SQLite cannot DROP 0001's inline single-column unique without a full table
    # rebuild (its name is an implicit autoindex), so that legacy unique SURVIVES here and the
    # SQLite-via-migration schema is NOT cross-source coexistence-safe. That is acceptable
    # because no runtime uses it: dev/test build the schema from create_all (composite-only,
    # coexistence-safe) and prod is Postgres (the else branch drops the old unique and adds the
    # real composite constraint, matching the model). The SQLite migration chain is exercised
    # only by test_migrations.py, which checks table/column/index shape, not
    # uniqueness; cross-source coexistence on a *migrated* schema is proven on Postgres in
    # tests/test_postgres_smoke.py.
    if op.get_bind().dialect.name == "sqlite":
        op.create_index(
            "uq_crime_source_external_id",
            "crime_incidents",
            ["source_dataset", "external_incident_id"],
            unique=True,
        )
    else:
        op.create_unique_constraint(
            "uq_crime_source_external_id",
            "crime_incidents",
            ["source_dataset", "external_incident_id"],
        )
        # 0001 created this via inline unique=True; on Postgres its auto name is
        # crime_incidents_external_incident_id_key.
        op.drop_constraint(
            "crime_incidents_external_incident_id_key", "crime_incidents", type_="unique"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        op.drop_index("uq_crime_source_external_id", table_name="crime_incidents")
    else:
        op.create_unique_constraint(
            "crime_incidents_external_incident_id_key",
            "crime_incidents",
            ["external_incident_id"],
        )
        op.drop_constraint(
            "uq_crime_source_external_id", "crime_incidents", type_="unique"
        )
    op.drop_index("ix_crime_incidents_source_dataset", table_name="crime_incidents")
