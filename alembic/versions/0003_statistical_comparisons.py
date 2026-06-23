"""statistical comparisons

Revision ID: 0003_statistical_comparisons
Revises: 0002_route_alternatives
Create Date: 2026-06-23
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003_statistical_comparisons"
down_revision = "0002_route_alternatives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "statistical_comparisons",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("comparison_type", sa.Text(), nullable=False),
        sa.Column(
            "source_route_request_id",
            sa.String(length=36),
            sa.ForeignKey("route_requests.id"),
            nullable=True,
        ),
        sa.Column("geometry_type", sa.Text(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False),
        sa.Column("analysis_start_date", sa.Date(), nullable=False),
        sa.Column("analysis_end_date", sa.Date(), nullable=False),
        sa.Column("offense_category", sa.Text(), nullable=True),
        sa.Column("offense_subcategory", sa.Text(), nullable=True),
        sa.Column("nibrs_group", sa.Text(), nullable=True),
        sa.Column("source_dataset", sa.Text(), nullable=False),
        sa.Column("exposure_unit", sa.Text(), nullable=False),
        sa.Column("decision_class", sa.Text(), nullable=False),
        sa.Column("recommendation_option_id", sa.Text(), nullable=True),
        sa.Column("recommendation_label", sa.Text(), nullable=True),
        sa.Column("overview_summary_text", sa.Text(), nullable=False),
        sa.Column("overview_caveat_text", sa.Text(), nullable=False),
        sa.Column("full_caveat_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_statistical_comparisons_source_route_request_id",
        "statistical_comparisons",
        ["source_route_request_id"],
    )
    op.create_index(
        "ix_statistical_comparisons_user_id_hash",
        "statistical_comparisons",
        ["user_id_hash"],
    )

    op.create_table(
        "statistical_comparison_options",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "comparison_id",
            sa.String(length=36),
            sa.ForeignKey("statistical_comparisons.id"),
            nullable=False,
        ),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("option_id", sa.Text(), nullable=False),
        sa.Column("option_label", sa.Text(), nullable=False),
        sa.Column("geometry_type", sa.Text(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False),
        sa.Column("incident_count", sa.Integer(), nullable=False),
        sa.Column("exposure", sa.Float(), nullable=False),
        sa.Column("exposure_unit", sa.Text(), nullable=False),
        sa.Column("incident_rate", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_statistical_comparison_options_comparison_id",
        "statistical_comparison_options",
        ["comparison_id"],
    )
    op.create_index(
        "ix_statistical_comparison_options_user_id_hash",
        "statistical_comparison_options",
        ["user_id_hash"],
    )

    op.create_table(
        "statistical_pairwise_results",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "comparison_id",
            sa.String(length=36),
            sa.ForeignKey("statistical_comparisons.id"),
            nullable=False,
        ),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("option_a_id", sa.Text(), nullable=False),
        sa.Column("option_a_label", sa.Text(), nullable=False),
        sa.Column("option_b_id", sa.Text(), nullable=False),
        sa.Column("option_b_label", sa.Text(), nullable=False),
        sa.Column("winner_option_id", sa.Text(), nullable=True),
        sa.Column("winner_label", sa.Text(), nullable=True),
        sa.Column("decision_class", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("incident_count_a", sa.Integer(), nullable=False),
        sa.Column("incident_count_b", sa.Integer(), nullable=False),
        sa.Column("exposure_a", sa.Float(), nullable=False),
        sa.Column("exposure_b", sa.Float(), nullable=False),
        sa.Column("exposure_unit", sa.Text(), nullable=False),
        sa.Column("rate_a", sa.Float(), nullable=False),
        sa.Column("rate_b", sa.Float(), nullable=False),
        sa.Column("rate_ratio", sa.Float(), nullable=False),
        sa.Column("ci_lower", sa.Float(), nullable=False),
        sa.Column("ci_upper", sa.Float(), nullable=False),
        sa.Column("p_value", sa.Float(), nullable=False),
        sa.Column("adjusted_p_value", sa.Float(), nullable=False),
        sa.Column("overdispersion_phi", sa.Float(), nullable=True),
        sa.Column("overdispersion_status", sa.Text(), nullable=False),
        sa.Column("minimum_data_status", sa.Text(), nullable=False),
        sa.Column("caveat_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_statistical_pairwise_results_comparison_id",
        "statistical_pairwise_results",
        ["comparison_id"],
    )
    op.create_index(
        "ix_statistical_pairwise_results_user_id_hash",
        "statistical_pairwise_results",
        ["user_id_hash"],
    )


def downgrade() -> None:
    op.drop_table("statistical_pairwise_results")
    op.drop_table("statistical_comparison_options")
    op.drop_table("statistical_comparisons")
