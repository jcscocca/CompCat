"""record selected places on analysis runs

Revision ID: 0016_analysis_run_places
Revises: 0015_session_activity
Create Date: 2026-07-30
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016_analysis_run_places"
down_revision = "0015_session_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable keeps existing run rows valid. The analytical export falls back to attached
    # summaries for those historical runs; new runs record even zero-count selections.
    op.add_column("analysis_runs", sa.Column("place_ids_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("analysis_runs", "place_ids_json")
