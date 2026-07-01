from __future__ import annotations

from collections.abc import Sequence

from app.api.dashboard_schemas import AnalysisPoint
from app.schemas import PlaceClusterData


def point_clusters(points: Sequence[AnalysisPoint]) -> list[PlaceClusterData]:
    """Turn inline shared-view points into synthetic, non-persisted PlaceClusterData
    with display == centroid == the given coordinate. Used when a request supplies
    `points` instead of identity-bound `place_ids`."""
    clusters: list[PlaceClusterData] = []
    for point in points:
        clusters.append(
            PlaceClusterData(
                user_id_hash="",
                cluster_version="shared_view",
                cluster_method="shared_view",
                centroid_latitude=point.latitude,
                centroid_longitude=point.longitude,
                display_latitude=point.latitude,
                display_longitude=point.longitude,
                visit_count=1,
                display_label=point.label,
            )
        )
    return clusters
