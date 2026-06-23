from datetime import date

from app.analysis.comparison import build_statistical_comparison
from app.analysis.schemas import AnalysisOptionResult, DecisionClass, GeometryType


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
    assert result.pairwise_results[0].method == "not_tested_minimum_data"
    assert result.pairwise_results[0].p_value == 1.0
    assert result.pairwise_results[0].adjusted_p_value == 1.0
