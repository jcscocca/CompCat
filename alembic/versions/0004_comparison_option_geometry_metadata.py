"""comparison option geometry metadata

Revision ID: 0004_comparison_option_geometry_metadata
Revises: 0003_statistical_comparisons
Create Date: 2026-06-23
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_comparison_option_geometry_metadata"
down_revision = "0003_statistical_comparisons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "statistical_comparison_options",
        sa.Column("geometry_metadata_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("statistical_comparison_options", "geometry_metadata_json")
