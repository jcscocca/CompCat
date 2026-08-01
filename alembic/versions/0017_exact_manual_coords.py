"""preserve exact coordinates for manually saved places

Revision ID: 0017_exact_manual_coords
Revises: 0016_analysis_run_places
Create Date: 2026-07-31
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0017_exact_manual_coords"
down_revision = "0016_analysis_run_places"
branch_labels = None
depends_on = None

MANUAL_CLUSTER_METHOD = "manual_public_dashboard"


def upgrade() -> None:
    place_clusters = sa.table(
        "place_clusters",
        sa.column("cluster_method", sa.Text()),
        sa.column("centroid_latitude", sa.Float()),
        sa.column("centroid_longitude", sa.Float()),
        sa.column("display_latitude", sa.Float()),
        sa.column("display_longitude", sa.Float()),
    )
    op.execute(
        place_clusters.update()
        .where(place_clusters.c.cluster_method == MANUAL_CLUSTER_METHOD)
        .values(
            display_latitude=place_clusters.c.centroid_latitude,
            display_longitude=place_clusters.c.centroid_longitude,
        )
    )


def downgrade() -> None:
    place_clusters = sa.table(
        "place_clusters",
        sa.column("cluster_method", sa.Text()),
        sa.column("centroid_latitude", sa.Float()),
        sa.column("centroid_longitude", sa.Float()),
        sa.column("display_latitude", sa.Float()),
        sa.column("display_longitude", sa.Float()),
    )
    op.execute(
        place_clusters.update()
        .where(place_clusters.c.cluster_method == MANUAL_CLUSTER_METHOD)
        .values(
            display_latitude=sa.func.round(place_clusters.c.centroid_latitude, 3),
            display_longitude=sa.func.round(place_clusters.c.centroid_longitude, 3),
        )
    )
