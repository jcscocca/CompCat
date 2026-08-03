"""add owned immutable analysis report snapshots

Revision ID: 0018_report_snapshots
Revises: 0017_exact_manual_coords
Create Date: 2026-08-02
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0018_report_snapshots"
down_revision = "0017_exact_manual_coords"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_report_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("method_version", sa.Text(), nullable=False),
        sa.Column("layer", sa.Text(), nullable=False),
        sa.Column("selection_kind", sa.Text(), nullable=False),
        sa.Column("comparison_mode", sa.Text(), nullable=False),
        sa.Column("selected_place_ids_json", sa.Text(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("privacy_policy_checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_analysis_report_snapshots_user_id_hash",
        "analysis_report_snapshots",
        ["user_id_hash"],
    )
    op.create_index(
        "ix_analysis_report_snapshots_created_at",
        "analysis_report_snapshots",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_analysis_report_snapshots_created_at",
        table_name="analysis_report_snapshots",
    )
    op.drop_index(
        "ix_analysis_report_snapshots_user_id_hash",
        table_name="analysis_report_snapshots",
    )
    op.drop_table("analysis_report_snapshots")
