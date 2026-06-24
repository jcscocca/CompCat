"""crime incident filter indexes

Revision ID: 0005_crime_filter_idx
Revises: 0004_option_geom_metadata
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op

revision = "0005_crime_filter_idx"
down_revision = "0004_option_geom_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_crime_incidents_offense_start_utc",
        "crime_incidents",
        ["offense_start_utc"],
    )
    op.create_index("ix_crime_incidents_report_utc", "crime_incidents", ["report_utc"])
    op.create_index(
        "ix_crime_incidents_offense_category",
        "crime_incidents",
        ["offense_category"],
    )
    op.create_index(
        "ix_crime_incidents_offense_subcategory",
        "crime_incidents",
        ["offense_subcategory"],
    )
    op.create_index("ix_crime_incidents_nibrs_group", "crime_incidents", ["nibrs_group"])
    op.create_index("ix_crime_incidents_latitude", "crime_incidents", ["latitude"])
    op.create_index("ix_crime_incidents_longitude", "crime_incidents", ["longitude"])


def downgrade() -> None:
    op.drop_index("ix_crime_incidents_longitude", table_name="crime_incidents")
    op.drop_index("ix_crime_incidents_latitude", table_name="crime_incidents")
    op.drop_index("ix_crime_incidents_nibrs_group", table_name="crime_incidents")
    op.drop_index("ix_crime_incidents_offense_subcategory", table_name="crime_incidents")
    op.drop_index("ix_crime_incidents_offense_category", table_name="crime_incidents")
    op.drop_index("ix_crime_incidents_report_utc", table_name="crime_incidents")
    op.drop_index("ix_crime_incidents_offense_start_utc", table_name="crime_incidents")
