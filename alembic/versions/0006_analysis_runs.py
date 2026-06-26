"""analysis run provenance

Revision ID: 0006_analysis_runs
Revises: 0005_crime_filter_idx
Create Date: 2026-06-26
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_analysis_runs"
down_revision = "0005_crime_filter_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("analysis_start_date", sa.Date(), nullable=False),
        sa.Column("analysis_end_date", sa.Date(), nullable=False),
        sa.Column("radii_m_json", sa.Text(), nullable=False),
        sa.Column("offense_category", sa.Text(), nullable=True),
        sa.Column("offense_subcategory", sa.Text(), nullable=True),
        sa.Column("nibrs_group", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_analysis_runs_user_id_hash", "analysis_runs", ["user_id_hash"])
    op.create_index("ix_analysis_runs_created_at", "analysis_runs", ["created_at"])
    op.add_column(
        "place_crime_summaries",
        sa.Column("analysis_run_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_place_crime_summaries_analysis_run_id", "place_crime_summaries", ["analysis_run_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_place_crime_summaries_analysis_run_id", table_name="place_crime_summaries")
    op.drop_column("place_crime_summaries", "analysis_run_id")
    op.drop_index("ix_analysis_runs_created_at", table_name="analysis_runs")
    op.drop_index("ix_analysis_runs_user_id_hash", table_name="analysis_runs")
    op.drop_table("analysis_runs")
