"""Regression tests for neighborhood-verdict statistics QA findings.

#1 — the verdict must honor overdispersion. The service previously adjusted and
     decided on a p-value computed WITHOUT the overdispersion factor, so an
     overdispersed place whose overdispersion-aware test is not significant could
     still ship as 'above_clear'.
#5 — the minimum-data gate must require a minimum PLACE signal, not just a
     combined (place + beat) count the busy beat satisfies on its own.
"""
from datetime import UTC, date, datetime

from app.analysis.beat_baselines import place_vs_beat
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.services.neighborhood_service import neighborhood_analysis_for_places
from app.sessions import public_user_hash
from tests.helpers_dashboard import square_beat_polygons

# Both quality scenarios place their cluster at (47.6100, -122.3300) in a synthetic beat
# "Z9"; a square polygon around that point pins the point-in-polygon beat assignment.
_Z9_POLYGONS = square_beat_polygons("Z9", 47.6100, -122.3300)


def _session_with_overdispersed_place(tmp_path):
    """One place with 13 incidents in its 250 m buffer plus 27 more in the same
    beat (outside the buffer), ALL in a single month -> strong temporal
    overdispersion. Sized (place 13 vs beat 40, ~35 vs ~360 km^2-days) so the
    no-phi exact test is significant but the phi-aware quasi-Poisson test is not.
    """
    from fastapi.testclient import TestClient

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'od.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_hash is not None

    place_lat, place_lon = 47.6100, -122.3300
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="od-place", user_id_hash=user_hash, cluster_version="t", cluster_method="manual",
            centroid_latitude=place_lat, centroid_longitude=place_lon,
            display_latitude=place_lat, display_longitude=place_lon,
            visit_count=5, inferred_place_type="manual_place", sensitivity_class="normal",
            display_label="OD place", label_source="test",
        )
    )
    near = [
        (0.0005, 0.0), (0.0008, 0.0003), (0.0, 0.0010), (0.0012, 0.0), (-0.0007, 0.0005),
        (0.0006, -0.0004), (0.0009, 0.0006), (-0.0010, 0.0), (0.0003, 0.0011),
        (0.0011, -0.0006), (-0.0005, -0.0008), (0.0007, 0.0009), (0.0, -0.0012),
    ]  # 13 offsets, all < ~250 m
    for i, (dlat, dlon) in enumerate(near):
        session.add(
            CrimeIncident(
                id=f"od-near-{i}", offense_start_utc=datetime(2026, 5, 15, tzinfo=UTC),
                offense_category="PROPERTY", beat="Z9",
                latitude=place_lat + dlat, longitude=place_lon + dlon,
            )
        )
    for i in range(27):  # 27 in beat Z9 but ~2 km away (outside the buffer), same month
        session.add(
            CrimeIncident(
                id=f"od-far-{i}", offense_start_utc=datetime(2026, 5, 15, tzinfo=UTC),
                offense_category="PROPERTY", beat="Z9",
                latitude=place_lat + 0.02 + i * 0.0005, longitude=place_lon + 0.02,
            )
        )
    session.commit()
    return session, user_hash


def test_overdispersed_place_verdict_honors_overdispersion(tmp_path):
    session, user_hash = _session_with_overdispersed_place(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=["od-place"], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"Z9": 2.0}, beat_polygons=_Z9_POLYGONS,
    )
    place = result["places"][0]
    assert place["place_incident_count"] == 13
    assert place["beat_incident_count"] == 27
    assert place["overdispersion_status"] == "overdispersed"
    # The overdispersion-aware test is NOT significant, so the verdict must not
    # claim 'above_clear', and the adjusted p must reflect the inflated variance.
    assert place["adjusted_p_value"] > 0.05
    assert place["decision"] == "not_clear"


def test_place_vs_beat_insufficient_when_place_count_below_floor():
    # A busy beat (combined count well over the threshold) must NOT yield a
    # confident verdict for a place that has essentially no incidents of its own.
    result = place_vs_beat(
        place_count=0, place_exposure=35.0, beat_count=300, beat_exposure=360.0,
        combined_monthly_counts=[50, 50, 50, 50, 50, 50], analysis_days=180,
    )
    assert result.minimum_data_status == "place_count_too_low"
    assert result.decision == "insufficient_data"


def _session_with_hotspot_place(tmp_path):
    """12 incidents inside the 250 m buffer (2/month, low temporal dispersion) and 6
    elsewhere in the same beat (1/month). With the rest-of-beat baseline the contrast
    is sharp and not overdispersed, so the verdict is 'above_clear'."""
    from fastapi.testclient import TestClient

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'hot.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    plat, plon = 47.6100, -122.3300
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="hot", user_id_hash=user_hash, cluster_version="t", cluster_method="manual",
            centroid_latitude=plat, centroid_longitude=plon,
            display_latitude=plat, display_longitude=plon, visit_count=5,
            inferred_place_type="manual_place", sensitivity_class="normal",
            display_label="Hot", label_source="test",
        )
    )
    for month in range(1, 7):
        for k in range(2):
            session.add(
                CrimeIncident(
                    id=f"hot-near-{month}-{k}",
                    offense_start_utc=datetime(2026, month, 10, tzinfo=UTC),
                    offense_category="PROPERTY", beat="Z9",
                    latitude=plat + 0.0005 + k * 0.0002, longitude=plon,
                )
            )
    for month in range(1, 7):
        session.add(
            CrimeIncident(
                id=f"hot-far-{month}",
                offense_start_utc=datetime(2026, month, 20, tzinfo=UTC),
                offense_category="PROPERTY", beat="Z9",
                latitude=plat + 0.02, longitude=plon + 0.02 + month * 0.0005,
            )
        )
    session.commit()
    return session, user_hash


def test_hotspot_reads_above_clear_after_removing_self_dilution(tmp_path):
    session, user_hash = _session_with_hotspot_place(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=["hot"], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"Z9": 3.0}, beat_polygons=_Z9_POLYGONS,
    )
    place = result["places"][0]
    assert place["place_incident_count"] == 12
    assert place["beat_incident_count"] == 6  # rest of beat only
    assert place["decision"] == "above_clear"
