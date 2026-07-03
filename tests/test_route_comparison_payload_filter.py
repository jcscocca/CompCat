from datetime import UTC, date, datetime

from app.analysis.schemas import DecisionClass, GeometryType, RouteComparisonRequest
from app.db import get_sessionmaker
from app.main import create_app
from app.models import (
    CrimeIncident,
    RouteAlternative,
    RouteRequest,
    StatisticalComparison,
)
from app.services.analysis_service import (
    compare_route_request,
    latest_route_comparison_payload,
)


def _seed_route_request(session, request_id, user_hash):
    session.add(
        RouteRequest(
            id=request_id,
            user_id_hash=user_hash,
            origin_label="Origin",
            origin_latitude=47.600,
            origin_longitude=-122.340,
            destination_label="Destination",
            destination_latitude=47.630,
            destination_longitude=-122.340,
            mode="transit",
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 2, 29),
        )
    )
    session.flush()


def _stale_corridor_comparison(request_id, user_hash):
    return StatisticalComparison(
        id="cmp-stale-corridor",
        user_id_hash=user_hash,
        comparison_type="route",
        source_route_request_id=request_id,
        geometry_type=GeometryType.ROUTE_CORRIDOR.value,
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 2, 29),
        source_dataset="seattle_spd_crime",
        exposure_unit="square_km_days",
        decision_class=DecisionClass.STATISTICALLY_LOWER.value,
        recommendation_option_id="alt-direct",
        recommendation_label="Route A",
        overview_summary_text="stale whole-corridor verdict",
        overview_caveat_text="caveat",
        full_caveat_text="full caveat",
    )


def test_latest_route_comparison_payload_ignores_stale_whole_corridor(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "stale-only-user"
    _seed_route_request(session, "rr-stale", user_hash)
    session.add(_stale_corridor_comparison("rr-stale", user_hash))
    session.commit()

    assert latest_route_comparison_payload(session, "rr-stale", user_hash) is None
    session.close()


def test_latest_route_comparison_payload_serves_divergent_over_stale(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "divergent-wins-user"
    _seed_route_request(session, "rr-divergent", user_hash)
    session.add(_stale_corridor_comparison("rr-divergent", user_hash))
    session.add_all(
        [
            RouteAlternative(
                id="alt-direct",
                route_request_id="rr-divergent",
                user_id_hash=user_hash,
                provider_route_id="prov-direct",
                route_label="Route A",
                rank=1,
                mode_mix="transit",
                summary_geometry="47.600,-122.340;47.630,-122.340",
            ),
            RouteAlternative(
                id="alt-jog",
                route_request_id="rr-divergent",
                user_id_hash=user_hash,
                provider_route_id="prov-jog",
                route_label="Route B",
                rank=2,
                mode_mix="transit",
                summary_geometry=(
                    "47.600,-122.340;47.615,-122.340;47.615,-122.310;"
                    "47.630,-122.310;47.630,-122.340"
                ),
            ),
        ]
    )
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-shared-{index}",
                offense_start_utc=datetime(
                    2024, 1 + (index % 2), 1 + (index // 2) % 27, tzinfo=UTC
                ),
                offense_category="PROPERTY",
                latitude=47.605,
                longitude=-122.340,
            )
            for index in range(40)
        ]
    )
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-a-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 10 + index // 2, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.622,
                longitude=-122.340,
            )
            for index in range(10)
        ]
    )
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-b-{index}",
                offense_start_utc=datetime(
                    2024, 1 + (index % 2), 1 + (index // 2) % 27, tzinfo=UTC
                ),
                offense_category="PROPERTY",
                latitude=47.6225,
                longitude=-122.310,
            )
            for index in range(150)
        ]
    )
    session.commit()

    compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-divergent",
            radius_m=250,
            offense_category="PROPERTY",
        ),
    )

    payload = latest_route_comparison_payload(session, "rr-divergent", user_hash)
    assert payload is not None
    assert payload["geometry_type"] == GeometryType.ROUTE_DIVERGENT_CORRIDOR.value
    assert payload["id"] != "cmp-stale-corridor"
    session.close()


def test_route_comparison_endpoint_returns_no_comparison_shape_for_stale_only(tmp_path):
    from fastapi.testclient import TestClient

    from app.services.users import hash_demo_user

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    headers = {"X-Demo-User-Id": "stale-endpoint-user@example.com"}
    user_hash = hash_demo_user("stale-endpoint-user@example.com")

    session = get_sessionmaker()()
    _seed_route_request(session, "rr-endpoint-stale", user_hash)
    session.add(_stale_corridor_comparison("rr-endpoint-stale", user_hash))
    session.commit()
    session.close()

    response = client.get(
        "/internal/routes/requests/rr-endpoint-stale/comparison",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["statistical_comparison"] is None
