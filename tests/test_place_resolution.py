from __future__ import annotations

from app.assistant.place_resolution import resolve_place_queries
from app.db import get_sessionmaker
from app.geocoding.providers import GeocodeHit, GeocoderUpstreamError
from app.main import create_app
from app.models import PlaceCluster


class FakeProvider:
    def __init__(self, hits=None, error=False):
        self._hits = hits or []
        self._error = error

    def search(self, query):
        if self._error:
            raise GeocoderUpstreamError("upstream down")
        return self._hits


def _session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="home-1",
            user_id_hash="user-1",
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.61,
            centroid_longitude=-122.33,
            display_latitude=47.61,
            display_longitude=-122.33,
            visit_count=1,
            sensitivity_class="normal",
            display_label="Home",
            inferred_place_type="manual_place",
            label_source="manual",
        )
    )
    session.commit()
    return session


def test_resolver_matches_existing_place_case_insensitively(tmp_path):
    session = _session(tmp_path)
    provider = FakeProvider()
    try:
        resolved = resolve_place_queries(session, "user-1", ["  home "], provider)
    finally:
        session.close()
    assert resolved.place_ids == ["home-1"]
    assert resolved.matched[0]["place_id"] == "home-1"
    assert resolved.created == []
    assert resolved.unresolved == []


def test_resolver_geocodes_and_creates_missing_place(tmp_path):
    session = _session(tmp_path)
    provider = FakeProvider(
        hits=[
            GeocodeHit(
                label="Pike Place Market, Seattle, WA",
                latitude=47.6097,
                longitude=-122.3422,
                source="nominatim",
            )
        ]
    )
    try:
        resolved = resolve_place_queries(session, "user-1", ["Pike Place Market"], provider)
        created_id = resolved.created[0]["place_id"]
        place = session.get(PlaceCluster, created_id)
    finally:
        session.close()
    assert resolved.place_ids == [created_id]
    assert resolved.created[0]["label"] == "Pike Place Market"
    assert resolved.created[0]["address"] == "Pike Place Market, Seattle, WA"
    assert place is not None
    assert place.display_label == "Pike Place Market"
    assert place.inferred_place_type == "manual_place"


def test_resolver_reports_unresolved_on_geocoder_failure(tmp_path):
    session = _session(tmp_path)
    try:
        resolved = resolve_place_queries(session, "user-1", ["Nowhere"], FakeProvider(error=True))
    finally:
        session.close()
    assert resolved.place_ids == []
    assert resolved.unresolved == ["Nowhere"]
