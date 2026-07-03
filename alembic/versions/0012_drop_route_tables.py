"""Drop route tables and the statistical_comparisons route FK.

Revision ID: 0012_drop_route_tables
Revises: 0011_arrest_category_backfill
Create Date: 2026-07-03

Routes feature removed 2026-07 (spec: docs/superpowers/specs/
2026-07-03-routes-removal-design.md). Route-sourced comparison rows are
deleted; place comparisons are untouched. Downgrade recreates the schema
only; deleted rows are not restored.
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012_drop_route_tables"
down_revision = "0011_arrest_category_backfill"
branch_labels = None
depends_on = None

ROUTE_TABLES = (
    "route_context_summaries",
    "route_segments",
    "route_alternatives",
    "route_requests",
)


def upgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM statistical_comparisons "
            "WHERE source_route_request_id IS NOT NULL"
        )
    )
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("statistical_comparisons") as batch_op:
            batch_op.drop_index("ix_statistical_comparisons_source_route_request_id")
            batch_op.drop_column("source_route_request_id")
    else:
        op.drop_index(
            "ix_statistical_comparisons_source_route_request_id",
            table_name="statistical_comparisons",
        )
        op.drop_column("statistical_comparisons", "source_route_request_id")
    for table in ROUTE_TABLES:
        op.drop_table(table)


def downgrade() -> None:
    op.create_table(
        "route_requests",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("origin_label", sa.Text(), nullable=False),
        sa.Column("origin_latitude", sa.Float(), nullable=False),
        sa.Column("origin_longitude", sa.Float(), nullable=False),
        sa.Column("origin_display_latitude", sa.Float(), nullable=True),
        sa.Column("origin_display_longitude", sa.Float(), nullable=True),
        sa.Column("origin_location_type", sa.Text(), nullable=False),
        sa.Column("destination_label", sa.Text(), nullable=False),
        sa.Column("destination_latitude", sa.Float(), nullable=False),
        sa.Column("destination_longitude", sa.Float(), nullable=False),
        sa.Column("destination_display_latitude", sa.Float(), nullable=True),
        sa.Column("destination_display_longitude", sa.Float(), nullable=True),
        sa.Column("destination_location_type", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("departure_date", sa.Date(), nullable=True),
        sa.Column("departure_time", sa.Text(), nullable=True),
        sa.Column("time_window", sa.Text(), nullable=True),
        sa.Column("preferences_json", sa.Text(), nullable=True),
        sa.Column("privacy_level", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("analysis_start_date", sa.Date(), nullable=True),
        sa.Column("analysis_end_date", sa.Date(), nullable=True),
        sa.Column("radii_m_json", sa.Text(), nullable=True),
        sa.Column("layer", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_route_requests_user_id_hash", "route_requests", ["user_id_hash"])

    op.create_table(
        "route_alternatives",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "route_request_id",
            sa.String(length=36),
            sa.ForeignKey("route_requests.id"),
            nullable=False,
        ),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("provider_route_id", sa.Text(), nullable=False),
        sa.Column("route_label", sa.Text(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("duration_minutes", sa.Float(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("transfer_count", sa.Integer(), nullable=False),
        sa.Column("walking_distance_m", sa.Float(), nullable=True),
        sa.Column("mode_mix", sa.Text(), nullable=False),
        sa.Column("summary_geometry", sa.Text(), nullable=True),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("provider_metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_route_alternatives_route_request_id",
        "route_alternatives",
        ["route_request_id"],
    )
    op.create_index(
        "ix_route_alternatives_user_id_hash",
        "route_alternatives",
        ["user_id_hash"],
    )

    op.create_table(
        "route_segments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "route_alternative_id",
            sa.String(length=36),
            sa.ForeignKey("route_alternatives.id"),
            nullable=False,
        ),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("segment_type", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("start_label", sa.Text(), nullable=False),
        sa.Column("start_latitude", sa.Float(), nullable=False),
        sa.Column("start_longitude", sa.Float(), nullable=False),
        sa.Column("end_label", sa.Text(), nullable=False),
        sa.Column("end_latitude", sa.Float(), nullable=False),
        sa.Column("end_longitude", sa.Float(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("duration_minutes", sa.Float(), nullable=True),
        sa.Column("geometry", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_route_segments_route_alternative_id",
        "route_segments",
        ["route_alternative_id"],
    )
    op.create_index("ix_route_segments_user_id_hash", "route_segments", ["user_id_hash"])

    op.create_table(
        "route_context_summaries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id_hash", sa.Text(), nullable=False),
        sa.Column(
            "route_alternative_id",
            sa.String(length=36),
            sa.ForeignKey("route_alternatives.id"),
            nullable=False,
        ),
        sa.Column(
            "route_segment_id",
            sa.String(length=36),
            sa.ForeignKey("route_segments.id"),
            nullable=True,
        ),
        sa.Column("context_label", sa.Text(), nullable=False),
        sa.Column("context_type", sa.Text(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False),
        sa.Column("analysis_start_date", sa.Date(), nullable=False),
        sa.Column("analysis_end_date", sa.Date(), nullable=False),
        sa.Column("offense_category", sa.Text(), nullable=True),
        sa.Column("offense_subcategory", sa.Text(), nullable=True),
        sa.Column("nibrs_group", sa.Text(), nullable=True),
        sa.Column("incident_count", sa.Integer(), nullable=False),
        sa.Column("nearest_incident_m", sa.Float(), nullable=True),
        sa.Column("incidents_per_route", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_route_context_summaries_route_alternative_id",
        "route_context_summaries",
        ["route_alternative_id"],
    )
    op.create_index(
        "ix_route_context_summaries_route_segment_id",
        "route_context_summaries",
        ["route_segment_id"],
    )
    op.create_index(
        "ix_route_context_summaries_user_id_hash",
        "route_context_summaries",
        ["user_id_hash"],
    )

    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("statistical_comparisons") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "source_route_request_id",
                    sa.String(length=36),
                    sa.ForeignKey(
                        "route_requests.id",
                        name="fk_statistical_comparisons_source_route_request_id",
                    ),
                    nullable=True,
                )
            )
            batch_op.create_index(
                "ix_statistical_comparisons_source_route_request_id",
                ["source_route_request_id"],
            )
    else:
        op.add_column(
            "statistical_comparisons",
            sa.Column(
                "source_route_request_id",
                sa.String(length=36),
                sa.ForeignKey("route_requests.id"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_statistical_comparisons_source_route_request_id",
            "statistical_comparisons",
            ["source_route_request_id"],
        )
