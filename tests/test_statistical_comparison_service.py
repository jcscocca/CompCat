from datetime import UTC, date, datetime

from app.analysis.comparison import build_statistical_comparison
from app.analysis.schemas import (
    AnalysisOptionResult,
    DecisionClass,
    GeometryType,
    RouteComparisonRequest,
)
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, RouteRequest
from app.services.analysis_service import compare_route_request, compare_site_options


def test_build_statistical_comparison_recommends_candidate_only_when_all_pairs_pass():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Route A",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=28,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=28 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [2, 2, 2, 2],
            "b": [7, 7, 7, 7],
        },
    )

    assert result.decision_class == DecisionClass.STATISTICALLY_LOWER
    assert result.recommendation_option_id == "a"
    assert result.recommendation_label == "Route A"
    assert "statistically lower reported-incident rate" in result.overview_summary_text
    assert "safe" not in result.overview_summary_text.lower()
    assert (
        result.overview_caveat_text
        == "This describes reported incidents, not causation or personal outcomes."
    )
    assert result.pairwise_results[0].adjusted_p_value == result.pairwise_results[0].p_value
    assert result.pairwise_results[0].winner_option_id == "a"
    assert result.pairwise_results[0].winner_label == "Route A"
    assert result.pairwise_results[0].overdispersion_status == "poisson_ok"


def test_build_statistical_comparison_keeps_alternatives_when_result_is_not_clear():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Route A",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=10,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=10 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [2, 2, 2, 2],
            "b": [3, 3, 2, 2],
        },
    )

    assert result.decision_class == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert result.recommendation_option_id is None
    assert "no statistically clear lower-incident alternative" in result.overview_summary_text
    assert result.pairwise_results[0].winner_option_id is None
    assert result.pairwise_results[0].winner_label is None


def test_build_statistical_comparison_requires_candidate_to_pass_all_pairwise_tests():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Route A",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=28,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=28 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="c",
                option_label="Route C",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=10,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=10 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [2, 2, 2, 2],
            "b": [7, 7, 7, 7],
            "c": [3, 3, 2, 2],
        },
    )

    assert len(result.pairwise_results) == 2
    assert result.decision_class == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert result.recommendation_option_id is None
    assert any(
        pairwise.decision_class == DecisionClass.STATISTICALLY_LOWER
        for pairwise in result.pairwise_results
    )
    assert any(
        pairwise.decision_class == DecisionClass.NOT_STATISTICALLY_CLEAR
        for pairwise in result.pairwise_results
    )
    assert all(
        pairwise.adjusted_p_value >= pairwise.p_value for pairwise in result.pairwise_results
    )
    for pairwise in result.pairwise_results:
        if pairwise.decision_class == DecisionClass.STATISTICALLY_LOWER:
            assert pairwise.winner_option_id == "a"
            assert pairwise.winner_label == "Route A"
        else:
            assert pairwise.winner_option_id is None
            assert pairwise.winner_label is None


def test_build_statistical_comparison_blocks_short_date_ranges():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 15),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Site A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=1,
                exposure=10.0,
                exposure_unit="square_km_days",
                incident_rate=0.1,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Site B",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=20,
                exposure=10.0,
                exposure_unit="square_km_days",
                incident_rate=2.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [1],
            "b": [20],
        },
    )

    assert result.decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.recommendation_option_id is None
    assert result.pairwise_results[0].minimum_data_status == "date_range_too_short"
    assert result.pairwise_results[0].winner_option_id is None
    assert result.pairwise_results[0].winner_label is None


def test_build_statistical_comparison_handles_non_positive_exposure_without_raising():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Site A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=1,
                exposure=0.0,
                exposure_unit="square_km_days",
                incident_rate=0.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Site B",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=20,
                exposure=10.0,
                exposure_unit="square_km_days",
                incident_rate=2.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [1],
            "b": [20],
        },
    )

    assert result.decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.recommendation_option_id is None
    assert result.pairwise_results[0].decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.pairwise_results[0].minimum_data_status == "non_positive_exposure"
    assert result.pairwise_results[0].winner_option_id is None
    assert result.pairwise_results[0].winner_label is None
    assert result.pairwise_results[0].method == "not_tested_minimum_data"
    assert result.pairwise_results[0].p_value == 1.0
    assert result.pairwise_results[0].adjusted_p_value == 1.0


def test_compare_site_options_counts_incidents_persists_and_returns_payload(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"a-{index}",
                offense_start_utc=datetime(2024, 1, 10 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"b-{index}",
                offense_start_utc=datetime(2024, 1, 1 + (index % 28), tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6205,
                longitude=-122.3493,
            )
            for index in range(28)
        ],
    )
    session.commit()

    result = compare_site_options(
        session=session,
        user_id_hash="site-user",
        options=[
            {
                "id": "site-a",
                "label": "Site A",
                "latitude": 47.6116,
                "longitude": -122.3372,
                "radius_m": 250,
            },
            {
                "id": "site-b",
                "label": "Site B",
                "latitude": 47.6205,
                "longitude": -122.3493,
                "radius_m": 250,
            },
        ],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert result["overview"]["decision_class"] == "statistically_lower"
    assert result["overview"]["recommendation_label"] == "Site A"
    assert result["analytical"]["pairwise_results"][0]["method"] in {
        "exact_conditional_poisson",
        "quasi_poisson_log_rate_ratio",
    }
    assert result["id"]
    session.close()


def test_compare_route_request_returns_none_without_analysis_dates(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    route_request = RouteRequest(
        id="route-without-analysis-dates",
        user_id_hash="route-user",
        origin_label="Origin",
        origin_latitude=47.6116,
        origin_longitude=-122.3372,
        destination_label="Destination",
        destination_latitude=47.6205,
        destination_longitude=-122.3493,
        mode="transit",
    )
    session.add(route_request)
    session.commit()

    result = compare_route_request(
        session=session,
        user_id_hash="route-user",
        request=RouteComparisonRequest(
            route_request_id=route_request.id,
            radius_m=250,
        ),
    )

    assert result is None
    session.close()
