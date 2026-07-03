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
from app.models import CrimeIncident, RouteAlternative, RouteRequest
from app.schemas import CrimeIncidentData
from app.services.analysis_service import (
    _monthly_counts,
    _route_pair_divergence_inputs,
    compare_route_request,
    compare_site_options,
)


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
    # Output-side invariant guard: the engine's user-facing verdict reports reported-incident
    # context only — never safe/unsafe/danger/risk vocabulary, even on a "winning" comparison.
    verdict_text = " ".join(
        [
            result.decision_class.value,
            result.overview_summary_text,
            result.recommendation_label or "",
            result.pairwise_results[0].winner_label or "",
            result.pairwise_results[0].decision_class.value,
        ]
    ).lower()
    for banned in ("safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"):
        assert banned not in verdict_text, banned
    assert (
        result.overview_caveat_text
        == "This describes reported incidents, not causation or personal outcomes."
    )
    assert result.pairwise_results[0].adjusted_p_value == result.pairwise_results[0].p_value
    assert result.pairwise_results[0].winner_option_id == "a"
    assert result.pairwise_results[0].winner_label == "Route A"
    assert result.pairwise_results[0].overdispersion_status == "poisson_ok"


def test_build_statistical_comparison_floors_near_empty_candidate():
    # Product-invariant guard: a near-zero-incident option must NOT be declared the
    # "statistically lower" winner on combined count alone — that is a safety ranking on
    # no per-option signal. The per-option MIN_PLACE_COUNT floor (already enforced on the
    # neighborhood path) must apply to the compare/route path too.
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
                incident_count=0,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=0.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=300,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=300 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [0, 0, 0, 0],
            "b": [75, 75, 75, 75],
        },
    )

    assert result.decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.recommendation_option_id is None
    assert result.recommendation_label is None
    assert result.pairwise_results[0].minimum_data_status == "option_count_too_low"
    assert result.pairwise_results[0].winner_option_id is None
    assert "safe" not in result.overview_summary_text.lower()


def test_build_statistical_comparison_allows_candidate_at_min_place_count():
    # Boundary: a candidate sitting exactly at MIN_PLACE_COUNT, with a clear contrast,
    # still wins — the floor is a floor, not an off-by-one block.
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
                incident_count=3,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=3 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=60,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=60 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [1, 1, 1, 0],
            "b": [15, 15, 15, 15],
        },
    )

    assert result.decision_class == DecisionClass.STATISTICALLY_LOWER
    assert result.recommendation_option_id == "a"
    assert result.pairwise_results[0].minimum_data_status == "met"


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
                offense_start_utc=datetime(
                    2024,
                    1 + (index // 4),
                    10 + (index % 4),
                    tzinfo=UTC,
                ),
                offense_category="PROPERTY",
                latitude=47.6116,
                longitude=-122.3372,
            )
            for index in range(8)
        ]
        + [
            CrimeIncident(
                id=f"b-{index}",
                offense_start_utc=datetime(
                    2024,
                    1 + (index // 14),
                    1 + (index % 14),
                    tzinfo=UTC,
                ),
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
        analysis_end_date=date(2024, 2, 29),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert result["overview"]["decision_class"] == "statistically_lower"
    assert result["overview"]["recommendation_label"] == "Site A"
    assert result["overview"]["options"][0]["geometry_metadata"] == {
        "center": {"latitude": 47.6116, "longitude": -122.3372},
        "radius_m": 250,
    }
    assert result["analytical"]["pairwise_results"][0]["method"] in {
        "wald_log_rate_ratio",
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


def test_monthly_counts_align_zero_count_months():
    counts = _monthly_counts(
        incidents=[
            CrimeIncidentData(
                offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
                latitude=47.6116,
                longitude=-122.3372,
            ),
            CrimeIncidentData(
                offense_start_utc=datetime(2024, 3, 1, tzinfo=UTC),
                latitude=47.6116,
                longitude=-122.3372,
            ),
            CrimeIncidentData(
                offense_start_utc=datetime(2024, 3, 2, tzinfo=UTC),
                latitude=47.6116,
                longitude=-122.3372,
            ),
        ],
        analysis_start_date=date(2024, 1, 15),
        analysis_end_date=date(2024, 3, 2),
    )

    assert counts == [1, 0, 2]


def test_compare_route_request_floors_near_empty_candidate(tmp_path):
    # End-to-end through the route SERVICE path (not just the engine): a near-empty candidate
    # corridor must NOT be declared the lower-incident "winner" on combined count alone. The
    # per-option MIN_PLACE_COUNT floor lives in the shared build_statistical_comparison engine;
    # this proves compare_route_request actually feeds per-option counts into it, so the route
    # path applies the floor just like the site/neighborhood paths (the rigor asymmetry the
    # roadmap flagged does not exist).
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "route-floor-user"
    session.add(
        RouteRequest(
            id="rr-floor",
            user_id_hash=user_hash,
            origin_label="Origin",
            origin_latitude=47.610,
            origin_longitude=-122.340,
            destination_label="Destination",
            destination_latitude=47.662,
            destination_longitude=-122.300,
            mode="transit",
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 2, 29),
        )
    )
    session.flush()  # parent route_requests row must exist before its alternatives (FK)
    # Two corridors ~5 km apart so their 500 m buffers never overlap.
    session.add_all(
        [
            RouteAlternative(
                id="alt-a",
                route_request_id="rr-floor",
                user_id_hash=user_hash,
                provider_route_id="prov-a",
                route_label="Route A",
                rank=1,
                mode_mix="transit",
                summary_geometry="47.610,-122.340;47.612,-122.340",
            ),
            RouteAlternative(
                id="alt-b",
                route_request_id="rr-floor",
                user_id_hash=user_hash,
                provider_route_id="prov-b",
                route_label="Route B",
                rank=2,
                mode_mix="transit",
                summary_geometry="47.660,-122.300;47.662,-122.300",
            ),
        ]
    )
    # Candidate corridor A: a single incident (below MIN_PLACE_COUNT=3). Corridor B: 20.
    session.add(
        CrimeIncident(
            id="inc-a-1",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.611,
            longitude=-122.340,
        )
    )
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-b-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 5 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.661,
                longitude=-122.300,
            )
            for index in range(20)
        ]
    )
    session.commit()

    result = compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-floor",
            radius_m=500,
            offense_category="PROPERTY",
        ),
    )
    session.close()

    assert result is not None
    options = {option["label"]: option for option in result["overview"]["options"]}
    assert options["Route A"]["incident_count"] == 1  # candidate sits below the per-option floor
    assert options["Route B"]["incident_count"] == 20  # combined count is well over the floor
    # The floor blocks declaring the near-empty candidate the lower-incident winner.
    assert result["overview"]["decision_class"] == "insufficient_data"
    assert result["overview"]["recommendation_option_id"] is None
    assert result["overview"]["recommendation_label"] is None
    pairwise = result["analytical"]["pairwise_results"][0]
    assert pairwise["minimum_data_status"] == "option_count_too_low"
    assert pairwise["winner_option_id"] is None
    # Invariant: even a floored verdict reports reported-incident context, no safety language.
    assert "safe" not in result["overview"]["summary_text"].lower()


def test_candidate_selection_alone_does_not_manufacture_a_winner():
    # Selective-inference guard. The candidate is the lowest observed-rate option, chosen FROM
    # the data; Benjamini-Hochberg corrects the pairwise multiplicity but not that selection.
    # The decision stays conservative anyway: a winner needs the candidate to be statistically
    # lower than EVERY alternative AND materially lower (rate_ratio <= 0.80) than each. Here
    # three options have similar rates with ample data — the empirical-min candidate (A) is the
    # lowest but is not >=20% below either rival (A/B = 16/18 = 0.89, A/C = 16/19 = 0.84, both
    # above the 0.80 floor) — so NO winner is declared despite A being singled out. The verdict
    # is not_statistically_clear (insufficient evidence), NOT insufficient_data. See
    # docs/analysis/statistical-route-place-comparison.md (Candidate Selection And Selective
    # Inference).
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
                incident_count=16,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=16 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=18,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=18 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="c",
                option_label="Route C",
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=500,
                incident_count=19,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=19 / 30.0,
            ),
        ],
        period_counts_by_option_id={
            "a": [4, 4, 4, 4],
            "b": [5, 4, 5, 4],
            "c": [5, 5, 5, 4],
        },
    )

    assert result.decision_class == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert result.recommendation_option_id is None
    assert result.recommendation_label is None
    # This is about evidence, not missing data: every pair clears the data floors.
    assert all(pairwise.minimum_data_status == "met" for pairwise in result.pairwise_results)
    # Selection alone crowns no one: no pair reaches the statistically-lower bar.
    assert all(
        pairwise.decision_class != DecisionClass.STATISTICALLY_LOWER
        for pairwise in result.pairwise_results
    )


def test_compare_route_request_tests_divergent_corridors_only(tmp_path):
    # Two routes share a heavy-incident southern stretch on -122.340; A continues
    # straight north, B jogs east via -122.310 and rejoins at the destination. The 40
    # shared incidents land in BOTH whole corridors; the divergent test must ignore
    # them and decide on the 10-vs-150 divergent contrast.
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "route-divergence-user"
    session.add(
        RouteRequest(
            id="rr-divergent",
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
    # 40 shared incidents on the common southern stretch (inside BOTH 250 m corridors).
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
    # 10 incidents on A's divergent northern straight (>= 750 m from every B leg).
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
    # 150 incidents on B's divergent -122.310 leg (~2.25 km from A).
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

    result = compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-divergent",
            radius_m=250,
            offense_category="PROPERTY",
        ),
    )
    session.close()

    assert result is not None
    assert result["geometry_type"] == "route_divergent_corridor"
    # Context rows keep whole-corridor counts (shared incidents included).
    options = {option["label"]: option for option in result["overview"]["options"]}
    assert options["Route A"]["incident_count"] == 50
    assert options["Route B"]["incident_count"] == 190
    # The test itself saw only the divergent counts.
    pairwise = result["analytical"]["pairwise_results"][0]
    assert pairwise["incident_count_a"] == 10
    assert pairwise["incident_count_b"] == 150
    # Divergent exposure is a strict subset of the whole corridor, and B's long jog
    # diverges far more than A's straight — pins that divergent (not whole-corridor)
    # exposures reached the persisted rows, and that sides weren't swapped.
    assert pairwise["exposure_a"] < options["Route A"]["exposure"]
    assert pairwise["exposure_b"] > pairwise["exposure_a"]
    assert "only the divergent segments were compared" in pairwise["caveat_text"]
    assert result["overview"]["decision_class"] == "statistically_lower"
    assert result["overview"]["recommendation_label"] == "Route A"
    assert result["overview"]["summary_text"].startswith("Where these routes differ, Route A")


def test_route_pair_divergence_excludes_flank_incidents_on_shared_stretch():
    # Regression for the count/exposure region mismatch: A and B run parallel ~100 m
    # apart (well inside the 250 m radius), so the stretch is shared and contributes no
    # divergent exposure — yet an incident on A's outer flank (~200 m from A, ~300 m
    # from B) is in A's corridor only and used to enter count_a. Counts must be drawn
    # from the divergent spans, where the exposure denominator comes from.
    points_a = [(47.600, -122.340), (47.620, -122.340), (47.620, -122.320)]
    points_b = [(47.600, -122.34133), (47.620, -122.34133), (47.620, -122.360)]
    flank = CrimeIncidentData(
        offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
        latitude=47.610,
        longitude=-122.3373,
    )
    spur_a = CrimeIncidentData(
        offense_start_utc=datetime(2024, 1, 20, tzinfo=UTC),
        latitude=47.620,
        longitude=-122.325,
    )
    spur_b = CrimeIncidentData(
        offense_start_utc=datetime(2024, 2, 5, tzinfo=UTC),
        latitude=47.620,
        longitude=-122.355,
    )

    pair_inputs = _route_pair_divergence_inputs(
        alternatives=[RouteAlternative(id="alt-a"), RouteAlternative(id="alt-b")],
        points_by_alternative_id={"alt-a": points_a, "alt-b": points_b},
        corridor_incidents_by_alternative_id={
            "alt-a": [flank, spur_a],
            "alt-b": [spur_b],
        },
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 2, 29),
    )

    assert len(pair_inputs) == 1
    pair = pair_inputs[0]
    # The control incident on A's divergent spur counts; the shared-stretch flank
    # incident does not.
    assert pair.count_a == 1
    assert pair.count_b == 1
    assert pair.period_counts_a == [1, 0]
    assert pair.period_counts_b == [0, 1]
    assert pair.exposure_a > 0
    assert pair.exposure_b > 0


def test_compare_route_request_ignores_flank_incidents_when_routes_run_parallel(tmp_path):
    # A and B run parallel ~150 m apart on the long mid-stretch (shared at 250 m), then
    # each ends in its own divergent spur. Flank incidents sit east of A along the
    # parallel stretch — inside A's corridor, outside B's — and must not reach the
    # divergent test; only the spur incidents (4 vs 40) may.
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "route-flank-user"
    session.add(
        RouteRequest(
            id="rr-flank",
            user_id_hash=user_hash,
            origin_label="Origin",
            origin_latitude=47.600,
            origin_longitude=-122.340,
            destination_label="Destination",
            destination_latitude=47.620,
            destination_longitude=-122.340,
            mode="transit",
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 2, 29),
        )
    )
    session.flush()
    session.add_all(
        [
            RouteAlternative(
                id="alt-east",
                route_request_id="rr-flank",
                user_id_hash=user_hash,
                provider_route_id="prov-east",
                route_label="Route A",
                rank=1,
                mode_mix="transit",
                summary_geometry="47.600,-122.340;47.620,-122.340;47.620,-122.320",
            ),
            RouteAlternative(
                id="alt-west",
                route_request_id="rr-flank",
                user_id_hash=user_hash,
                provider_route_id="prov-west",
                route_label="Route B",
                rank=2,
                mode_mix="transit",
                summary_geometry="47.600,-122.342;47.620,-122.342;47.620,-122.362",
            ),
        ]
    )
    # 12 flank incidents ~200 m east of A's parallel stretch (~350 m from B).
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-flank-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 3 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.610,
                longitude=-122.3373,
            )
            for index in range(12)
        ]
    )
    # 4 incidents on A's divergent east spur.
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-spur-a-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 10 + index, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.620,
                longitude=-122.325,
            )
            for index in range(4)
        ]
    )
    # 40 incidents on B's divergent west spur.
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-spur-b-{index}",
                offense_start_utc=datetime(
                    2024, 1 + (index % 2), 1 + (index // 2) % 27, tzinfo=UTC
                ),
                offense_category="PROPERTY",
                latitude=47.620,
                longitude=-122.357,
            )
            for index in range(40)
        ]
    )
    session.commit()

    result = compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-flank",
            radius_m=250,
            offense_category="PROPERTY",
        ),
    )
    session.close()

    assert result is not None
    # Context rows keep whole-corridor counts (flank incidents included for A).
    options = {option["label"]: option for option in result["overview"]["options"]}
    assert options["Route A"]["incident_count"] == 16
    assert options["Route B"]["incident_count"] == 40
    # The divergent test saw only the spur incidents.
    pairwise = result["analytical"]["pairwise_results"][0]
    assert pairwise["incident_count_a"] == 4
    assert pairwise["incident_count_b"] == 40
    assert result["overview"]["decision_class"] == "statistically_lower"
    assert result["overview"]["recommendation_label"] == "Route A"


def test_compare_route_request_reports_effectively_identical_corridors(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "route-identical-user"
    session.add(
        RouteRequest(
            id="rr-identical",
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
    session.add_all(
        [
            RouteAlternative(
                id=f"alt-{suffix}",
                route_request_id="rr-identical",
                user_id_hash=user_hash,
                provider_route_id=f"prov-{suffix}",
                route_label=f"Route {suffix.upper()}",
                rank=rank,
                mode_mix="transit",
                summary_geometry="47.600,-122.340;47.630,-122.340",
            )
            for rank, suffix in ((1, "a"), (2, "b"))
        ]
    )
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 5 + index // 2, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.610,
                longitude=-122.340,
            )
            for index in range(12)
        ]
    )
    session.commit()

    result = compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-identical",
            radius_m=250,
            offense_category="PROPERTY",
        ),
    )
    session.close()

    assert result is not None
    pairwise = result["analytical"]["pairwise_results"][0]
    assert pairwise["minimum_data_status"] == "corridors_effectively_identical"
    assert result["overview"]["recommendation_option_id"] is None
    assert result["overview"]["summary_text"] == (
        "These route options follow essentially the same corridor at this radius, "
        "so there is no divergent segment to compare."
    )
