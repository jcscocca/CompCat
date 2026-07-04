from datetime import UTC, date, datetime

from app.analysis.comparison import build_statistical_comparison
from app.analysis.schemas import (
    AnalysisOptionResult,
    DecisionClass,
    GeometryType,
)
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.schemas import CrimeIncidentData
from app.services.analysis_service import (
    _monthly_counts,
    compare_site_options,
)


def test_build_statistical_comparison_recommends_candidate_only_when_all_pairs_pass():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
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
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.PLACE_BUFFER,
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


def test_build_statistical_comparison_attaches_per_option_rate_interval():
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
        options=[
            AnalysisOptionResult(
                option_id="a",
                option_label="Place A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Place B",
                geometry_type=GeometryType.PLACE_BUFFER,
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

    options = {option.option_id: option for option in result.options}
    for option in result.options:
        assert option.rate_ci_lower is not None
        assert option.rate_ci_upper is not None
        assert option.rate_ci_lower < option.incident_rate < option.rate_ci_upper
        assert option.rate_ci_method in {
            "poisson_rate_interval",
            "quasi_poisson_rate_interval",
        }
    # The higher-count address gets a tighter *relative* interval.
    a, b = options["a"], options["b"]
    assert (b.rate_ci_upper / b.rate_ci_lower) < (a.rate_ci_upper / a.rate_ci_lower)


def test_build_statistical_comparison_floors_near_empty_candidate():
    # Product-invariant guard: a near-zero-incident option must NOT be declared the
    # "statistically lower" winner on combined count alone — that is a safety ranking on
    # no per-option signal. The per-option MIN_PLACE_COUNT floor (already enforced on the
    # neighborhood path) must apply to every path that feeds this engine.
    result = build_statistical_comparison(
        user_id_hash="user",
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
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
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=0,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=0.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.PLACE_BUFFER,
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
        comparison_type="site",
        geometry_type=GeometryType.PLACE_BUFFER,
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
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=3,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=3 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.PLACE_BUFFER,
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
                option_label="Route A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.PLACE_BUFFER,
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
                option_label="Route A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=8,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=8 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=28,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=28 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="c",
                option_label="Route C",
                geometry_type=GeometryType.PLACE_BUFFER,
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
    # Each address carries its own persisted rate interval (survives the DB round-trip).
    analytical_options = result["analytical"]["options"]
    assert len(analytical_options) == 2
    for option in analytical_options:
        assert option["rate_ci_lower"] is not None
        assert option["rate_ci_upper"] is not None
        assert option["rate_ci_lower"] < option["incident_rate"] < option["rate_ci_upper"]
        assert option["rate_ci_method"] in {
            "poisson_rate_interval",
            "quasi_poisson_rate_interval",
        }
    assert result["id"]
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

def test_candidate_selection_alone_does_not_manufacture_a_winner():
    # Selective-inference guard. The candidate is the lowest observed-rate option, chosen FROM
    # the data; Benjamini-Hochberg corrects the pairwise multiplicity but not that selection.
    # The decision stays conservative anyway: a winner needs the candidate to be statistically
    # lower than EVERY alternative AND materially lower (rate_ratio <= 0.80) than each. Here
    # three options have similar rates with ample data — the empirical-min candidate (A) is the
    # lowest but is not >=20% below either rival (A/B = 16/18 = 0.89, A/C = 16/19 = 0.84, both
    # above the 0.80 floor) — so NO winner is declared despite A being singled out. The verdict
    # is not_statistically_clear (insufficient evidence), NOT insufficient_data. This is the
    # "candidate selection and selective inference" rationale: picking the empirical minimum
    # is itself a data-dependent selection, so the material-difference floor guards against
    # crowning it (the stats engine is documented under docs/architecture/).
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
                option_label="Route A",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=16,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=16 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="b",
                option_label="Route B",
                geometry_type=GeometryType.PLACE_BUFFER,
                radius_m=500,
                incident_count=18,
                exposure=30.0,
                exposure_unit="square_km_days",
                incident_rate=18 / 30.0,
            ),
            AnalysisOptionResult(
                option_id="c",
                option_label="Route C",
                geometry_type=GeometryType.PLACE_BUFFER,
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
