"""track pseudonymous session activity for retention

Revision ID: 0015_session_activity
Revises: 0014_retention_indexes
Create Date: 2026-07-28
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015_session_activity"
down_revision = "0014_retention_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_activity",
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id_hash"),
    )
    op.create_index(
        "ix_session_activity_last_seen_at",
        "session_activity",
        ["last_seen_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_activity_last_seen_at",
        table_name="session_activity",
    )
    op.drop_table("session_activity")
