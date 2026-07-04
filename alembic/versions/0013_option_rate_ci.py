"""Add per-address rate confidence interval columns to statistical_comparison_options.

Revision ID: 0013_option_rate_ci
Revises: 0012_drop_route_tables
Create Date: 2026-07-04

Backs the per-address quasi-Poisson rate interval (docs/analysis/
overdispersion-and-rate-intervals.md). All three columns are nullable so pre-existing
comparison rows read back as null. ADD COLUMN is native on SQLite and Postgres; the
downgrade drops via batch on SQLite (no native DROP COLUMN there).
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013_option_rate_ci"
down_revision = "0012_drop_route_tables"
branch_labels = None
depends_on = None

TABLE = "statistical_comparison_options"
COLUMNS = ("rate_ci_lower", "rate_ci_upper", "rate_ci_method")


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("rate_ci_lower", sa.Float(), nullable=True))
    op.add_column(TABLE, sa.Column("rate_ci_upper", sa.Float(), nullable=True))
    op.add_column(TABLE, sa.Column("rate_ci_method", sa.Text(), nullable=True))


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table(TABLE) as batch_op:
            for column in COLUMNS:
                batch_op.drop_column(column)
    else:
        for column in COLUMNS:
            op.drop_column(TABLE, column)
