import pytest
from pydantic import ValidationError

from app.api.dashboard_schemas import (
    AnalysisPoint,
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
)
from app.services.analysis_points import point_clusters

BASE = {"analysis_start_date": "2024-01-01", "analysis_end_date": "2024-01-31"}
PT = {"latitude": 47.61, "longitude": -122.34, "label": "Pike Place"}


def test_analyze_accepts_points_without_place_ids():
    req = DashboardAnalyzeRequest(points=[PT], radii_m=[250], **BASE)
    assert req.place_ids is None
    assert req.points[0].label == "Pike Place"


def test_analyze_rejects_both_place_ids_and_points():
    with pytest.raises(ValidationError):
        DashboardAnalyzeRequest(place_ids=["p1"], points=[PT], radii_m=[250], **BASE)


def test_analyze_rejects_neither_place_ids_nor_points():
    with pytest.raises(ValidationError):
        DashboardAnalyzeRequest(radii_m=[250], **BASE)


def test_points_rejected_outside_seattle_bbox():
    dc = {"latitude": 38.90, "longitude": -77.03, "label": "DC"}
    with pytest.raises(ValidationError):
        DashboardAnalyzeRequest(points=[dc], radii_m=[250], **BASE)


def test_compare_requires_two_points():
    with pytest.raises(ValidationError):
        DashboardCompareRequest(points=[PT], radius_m=250, **BASE)
    ok = DashboardCompareRequest(points=[PT, {**PT, "label": "Second"}], radius_m=250, **BASE)
    assert len(ok.points) == 2


def test_point_clusters_map_to_display_coordinates():
    clusters = point_clusters([AnalysisPoint(latitude=47.61, longitude=-122.34, label="Pike")])
    assert len(clusters) == 1
    c = clusters[0]
    assert (c.display_latitude, c.display_longitude) == (47.61, -122.34)
    assert (c.centroid_latitude, c.centroid_longitude) == (47.61, -122.34)
    assert c.display_label == "Pike"
    assert c.cluster_method == "shared_view"
    assert c.visit_count == 1
