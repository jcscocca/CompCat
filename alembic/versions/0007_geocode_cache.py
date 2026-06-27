"""geocode cache

Revision ID: 0007_geocode_cache
Revises: 0006_analysis_runs
Create Date: 2026-06-26
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0007_geocode_cache"
down_revision = "0006_analysis_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "geocode_cache",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("query_normalized", sa.Text(), nullable=False),
        sa.Column("results_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "provider", "query_normalized", name="uq_geocode_cache_provider_query"
        ),
    )


def downgrade() -> None:
    op.drop_table("geocode_cache")
