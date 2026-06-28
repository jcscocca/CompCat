from datetime import date

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import RouteContextSummary
from app.routing.schemas import RouteAlternativeData, RouteSegmentData
from app.services.users import hash_demo_user


def test_route_alternatives_api_creates_request_and_ranked_routes(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-user@example.com"}

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "departure_date": "2024-01-15",
            "departure_time": "08:00",
            "time_window": "weekday_morning",
            "preferences": ["fewer_transfers"],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["request"]["origin"]["label"] == "Capitol Hill"
    assert payload["request"]["destination"]["label"] == "Downtown Seattle"
    assert payload["request"]["provider"] == "mock"
    assert "user_id_hash" not in payload["request"]
    assert len(payload["alternatives"]) >= 2
    assert payload["alternatives"][0]["rank"] == 1
    assert payload["alternatives"][0]["provider_metadata"] == {
        "fixture": "capitol_hill_to_downtown"
    }
    assert "provider_metadata_json" not in payload["alternatives"][0]
    assert payload["alternatives"][0]["segments"]
    assert payload["context_summaries"] == []

    comparison = client.get(
        f"/internal/routes/requests/{payload['request']['id']}/comparison",
        headers=headers,
    )

    assert comparison.status_code == 200
    comparison_payload = comparison.json()
    assert comparison_payload["request"]["id"] == payload["request"]["id"]
    assert "user_id_hash" not in comparison_payload["request"]


def test_route_alternatives_api_rejects_unknown_origin(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Not A Seattle Place",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )

    assert response.status_code == 400
    assert "Unknown route place" in response.json()["detail"]


def test_route_alternatives_api_rejects_unsupported_provider(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "provider": "otp",
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )

    assert response.status_code == 400
    assert "Unsupported routing provider" in response.json()["detail"]


def test_route_alternatives_api_validates_route_request_values(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "teleport",
            "privacy_level": "precise",
            "radii_m": [0],
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )

    assert response.status_code == 422
    invalid_fields = {tuple(error["loc"]) for error in response.json()["detail"]}
    assert ("body", "mode") in invalid_fields
    assert ("body", "privacy_level") in invalid_fields
    assert ("body", "radii_m", 0) in invalid_fields


def test_route_comparison_is_scoped_to_request_user(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )

    assert response.status_code == 200
    request_id = response.json()["request"]["id"]

    comparison = client.get(
        f"/internal/routes/requests/{request_id}/comparison",
        headers={"X-Demo-User-Id": "different-user@example.com"},
    )

    assert comparison.status_code == 404


def test_route_alternatives_api_includes_sample_crime_context_summaries(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-user@example.com"}

    ingest = client.post("/internal/crime/ingest/sample")
    assert ingest.status_code == 200

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "context_summaries" in payload
    assert len(payload["context_summaries"]) >= 1
    assert all("user_id_hash" not in summary for summary in payload["context_summaries"])


def test_route_comparison_context_summaries_are_public_and_ordered(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-user@example.com"}

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    alternative_id = payload["alternatives"][0]["id"]
    user_id_hash = hash_demo_user("route-user@example.com")
    session = get_sessionmaker()()
    session.add_all(
        [
            RouteContextSummary(
                user_id_hash=user_id_hash,
                route_alternative_id=alternative_id,
                context_label="B segment",
                context_type="segment",
                radius_m=500,
                analysis_start_date=date(2024, 1, 1),
                analysis_end_date=date(2024, 1, 31),
                offense_category="PROPERTY",
                offense_subcategory="THEFT",
                nibrs_group="A",
                incident_count=2,
            ),
            RouteContextSummary(
                user_id_hash=user_id_hash,
                route_alternative_id=alternative_id,
                context_label="A segment",
                context_type="segment",
                radius_m=250,
                analysis_start_date=date(2024, 1, 1),
                analysis_end_date=date(2024, 1, 31),
                offense_category="PROPERTY",
                offense_subcategory="BURGLARY",
                nibrs_group="A",
                incident_count=1,
            ),
            RouteContextSummary(
                user_id_hash=user_id_hash,
                route_alternative_id=alternative_id,
                context_label="A segment",
                context_type="route",
                radius_m=250,
                analysis_start_date=date(2024, 1, 1),
                analysis_end_date=date(2024, 1, 31),
                offense_category="PERSON",
                offense_subcategory="ASSAULT",
                nibrs_group="A",
                incident_count=3,
            ),
        ]
    )
    session.commit()
    session.close()

    comparison = client.get(
        f"/internal/routes/requests/{payload['request']['id']}/comparison",
        headers=headers,
    )

    assert comparison.status_code == 200
    summaries = comparison.json()["context_summaries"]
    assert all("user_id_hash" not in summary for summary in summaries)
    assert [
        (
            summary["radius_m"],
            summary["context_label"],
            summary["context_type"],
            summary["offense_category"],
            summary["offense_subcategory"],
            summary["nibrs_group"],
        )
        for summary in summaries
    ] == [
        (250, "A segment", "route", "PERSON", "ASSAULT", "A"),
        (250, "A segment", "segment", "PROPERTY", "BURGLARY", "A"),
        (500, "B segment", "segment", "PROPERTY", "THEFT", "A"),
    ]


def test_route_alternatives_response_includes_statistical_comparison_when_analyzable(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-stat-user@example.com"}
    client.post("/internal/crime/ingest/sample")

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["statistical_comparison"]["overview"]["label"] == "Overview"
    assert payload["statistical_comparison"]["analytical"]["label"] == "Analytical"

    lookup = client.get(
        f"/internal/routes/requests/{payload['request']['id']}/comparison",
        headers=headers,
    )

    assert lookup.status_code == 200
    assert lookup.json()["statistical_comparison"]["id"] == payload["statistical_comparison"]["id"]


def test_route_alternatives_are_sorted_with_statistical_winner_first(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-stat-sort-user@example.com"}
    client.post("/internal/crime/ingest/sample")

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    recommendation = payload["statistical_comparison"]["overview"]["recommendation_option_id"]
    if recommendation is not None:
        assert payload["alternatives"][0]["id"] == recommendation


def test_route_alternatives_skips_statistical_comparison_for_single_alternative(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-stat-single-user@example.com"}
    client.post("/internal/crime/ingest/sample")

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "University District",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["alternatives"]) == 1
    assert payload["statistical_comparison"] is None


def test_route_alternatives_skips_statistical_comparison_for_unanalyzable_geometry(
    tmp_path,
    monkeypatch,
):
    class BadGeometryProvider:
        def get_routes(self, request):
            return [
                _bad_geometry_alternative(
                    request_id=request.id,
                    provider_route_id="bad-geometry-a",
                    label="Bad geometry A",
                    rank=1,
                ),
                _bad_geometry_alternative(
                    request_id=request.id,
                    provider_route_id="bad-geometry-b",
                    label="Bad geometry B",
                    rank=2,
                ),
            ]

    monkeypatch.setattr(
        "app.services.route_service.get_routing_provider",
        lambda provider_name, **_kwargs: BadGeometryProvider(),
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "route-stat-bad-geometry-user@example.com"}
    client.post("/internal/crime/ingest/sample")

    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [500],
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["alternatives"]) == 2
    assert payload["statistical_comparison"] is None


def _bad_geometry_alternative(
    *,
    request_id: str,
    provider_route_id: str,
    label: str,
    rank: int,
) -> RouteAlternativeData:
    alternative = RouteAlternativeData(
        route_request_id=request_id,
        provider_route_id=provider_route_id,
        route_label=label,
        rank=rank,
        duration_minutes=12 + rank,
        distance_m=1000,
        transfer_count=0,
        walking_distance_m=200,
        mode_mix="transit",
        summary_geometry=None,
        provider="mock",
    )
    alternative.segments = [
        RouteSegmentData(
            route_alternative_id=alternative.id,
            sequence=1,
            segment_type="direct",
            mode="transit",
            start_label="Capitol Hill",
            start_latitude=47.6193,
            start_longitude=-122.3193,
            end_label="Downtown Seattle",
            end_latitude=47.6097,
            end_longitude=-122.3331,
        )
    ]
    return alternative


def test_route_alternatives_maps_provider_error_to_502(tmp_path, monkeypatch):
    from app.routing.providers import RoutingProviderError

    class FailingProvider:
        def get_routes(self, request):
            raise RoutingProviderError("otp down")

    monkeypatch.setattr(
        "app.services.route_service.get_routing_provider",
        lambda provider_name, **_kwargs: FailingProvider(),
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )
    assert response.status_code == 502


def test_route_alternatives_uses_configured_default_provider(tmp_path, monkeypatch):
    from app.config import Settings
    from app.routing.mock_provider import MockRoutingProvider

    captured = {}

    def fake_factory(provider_name, *, opentripplanner_base_url="", opentripplanner_timeout_s=10.0):
        captured["provider_name"] = provider_name
        captured["base_url"] = opentripplanner_base_url
        return MockRoutingProvider()

    monkeypatch.setattr("app.services.route_service.get_routing_provider", fake_factory)
    monkeypatch.setattr(
        "app.services.route_service.get_settings",
        lambda: Settings(routing_provider="opentripplanner", opentripplanner_base_url="http://otp"),
    )
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    response = client.post(
        "/internal/routes/alternatives",
        json={
            "origin_label": "Capitol Hill",
            "destination_label": "Downtown Seattle",
            "mode": "transit",
        },
        headers={"X-Demo-User-Id": "route-user@example.com"},
    )
    assert response.status_code == 200
    assert captured["provider_name"] == "opentripplanner"
    assert captured["base_url"] == "http://otp"
    assert response.json()["request"]["provider"] == "opentripplanner"
