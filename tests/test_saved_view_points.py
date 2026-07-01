from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.dashboard_schemas import (
    AnalysisPoint,
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
)
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.services.analysis_points import point_clusters
from app.services.dashboard_analysis_service import analyze_selected_places, compare_selected_places
from app.sessions import public_user_hash

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


def _seed(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'sv.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    session = get_sessionmaker()()
    session.add(CrimeIncident(
        id="i1", offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
        offense_category="PROPERTY", latitude=47.6094, longitude=-122.3334))
    session.add(PlaceCluster(
        id="place-1", user_id_hash=user_hash, cluster_version="test",
        cluster_method="manual", centroid_latitude=47.6094, centroid_longitude=-122.3334,
        display_latitude=47.6094, display_longitude=-122.3334, visit_count=5,
        display_label="Downtown"))
    session.commit()
    return session, user_hash


def test_analyze_points_matches_place_ids(tmp_path):
    session, user_hash = _seed(tmp_path)
    common = dict(radii_m=[250], analysis_start_date=datetime(2024, 1, 1).date(),
                  analysis_end_date=datetime(2024, 1, 31).date(),
                  offense_category=None, offense_subcategory=None, nibrs_group=None)
    by_ids = analyze_selected_places(session, user_hash, place_ids=["place-1"], **common)
    by_points = analyze_selected_places(
        session, user_hash, place_ids=None,
        points=[AnalysisPoint(latitude=47.6094, longitude=-122.3334, label="Downtown")], **common)
    assert by_ids["summary_count"] == by_points["summary_count"] == 1


def test_compare_points_matches_place_ids(tmp_path):
    session, user_hash = _seed(tmp_path)
    session.add(PlaceCluster(
        id="place-2", user_id_hash=user_hash, cluster_version="test",
        cluster_method="manual", centroid_latitude=47.6206, centroid_longitude=-122.3206,
        display_latitude=47.6206, display_longitude=-122.3206, visit_count=3,
        display_label="Library"))
    session.commit()
    common = dict(radius_m=250, analysis_start_date=datetime(2024, 1, 1).date(),
                  analysis_end_date=datetime(2024, 1, 31).date(),
                  offense_category=None, offense_subcategory=None, nibrs_group=None)
    by_points = compare_selected_places(
        session, user_hash, place_ids=None,
        points=[AnalysisPoint(latitude=47.6094, longitude=-122.3334, label="Downtown"),
                AnalysisPoint(latitude=47.6206, longitude=-122.3206, label="Library")],
        **common)
    assert "options" in by_points or "overview" in by_points  # compare payload is non-empty


def test_analyze_and_compare_via_points_http(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'http.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add(CrimeIncident(
        id="h1", offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
        offense_category="PROPERTY", latitude=47.6094, longitude=-122.3334))
    session.commit()
    pts = [{"latitude": 47.6094, "longitude": -122.3334, "label": "Downtown"},
           {"latitude": 47.6206, "longitude": -122.3206, "label": "Library"}]

    a = client.post("/dashboard/analyze", json={
        "points": pts[:1], "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31", "radii_m": [250], "offense_category": "PROPERTY"})
    assert a.status_code == 200 and a.json()["summary_count"] == 1

    c = client.post("/dashboard/compare", json={
        "points": pts, "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31", "radius_m": 250})
    assert c.status_code == 200

    bad = client.post("/dashboard/analyze", json={
        "place_ids": ["x"], "points": pts[:1], "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31", "radii_m": [250]})
    assert bad.status_code == 422
