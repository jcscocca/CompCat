"""created_at indexes for the retention sweep

Revision ID: 0014_retention_indexes
Revises: 0013_option_rate_ci
Create Date: 2026-07-27

The nightly sweep (app/services/retention_service.py) selects by created_at on every
table it touches. analysis_runs.created_at was already indexed; these three were not, so
each batch would sequentially scan a table that grows with traffic and never shrinks.
"""
from __future__ import annotations

from alembic import op

revision = "0014_retention_indexes"
down_revision = "0013_option_rate_ci"
branch_labels = None
depends_on = None

INDEXES = (
    ("ix_place_clusters_created_at", "place_clusters"),
    ("ix_place_crime_summaries_created_at", "place_crime_summaries"),
    ("ix_statistical_comparisons_created_at", "statistical_comparisons"),
)


def upgrade() -> None:
    for name, table in INDEXES:
        op.create_index(name, table, ["created_at"])


def downgrade() -> None:
    for name, table in reversed(INDEXES):
        op.drop_index(name, table_name=table)
