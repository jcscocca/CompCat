import csv
import json
from io import StringIO

from app.exports.analysis import ANALYSIS_COLUMNS, build_analysis_csv


def _reference(kind: str = "mcpp", *, available: bool = True) -> dict[str, object]:
    return {
        "kind": kind,
        "label": "Downtown Commercial MCPP" if kind == "mcpp" else "Citywide",
        "available": available,
        "adequacy_status": "met" if available else "insufficient_polygon_coverage",
        "sampling_frame": "street_segment_midpoints",
        "sampling_frame_version": "seattle_snd_open_public_street_midpoints_v1",
        "computation": "exact" if kind == "mcpp" else "monte_carlo",
        "geography_components": [
            {
                "id": "DOWNTOWN COMMERCIAL" if kind == "mcpp" else "SEATTLE",
                "label": "Downtown Commercial" if kind == "mcpp" else "Seattle",
                "weight": 1.0,
                "center_count": 320 if kind == "mcpp" else 23_793,
            }
        ],
        "reference_center_count": 320 if kind == "mcpp" else 23_793,
        "reference_draw_count": 320 if kind == "mcpp" else 2_500,
        "monte_carlo_error": None if kind == "mcpp" else 0.0196,
        "covered_area_share": 1.0,
        "effective_geographies": 1.0,
        "target_count": 12,
        "p10": 4 if available else None,
        "p25": 6 if available else None,
        "median": 8 if available else None,
        "p75": 15 if available else None,
        "p90": 20 if available else None,
        "share_below": 0.68 if available else None,
        "share_equal": 0.07 if available else None,
        "share_above": 0.25 if available else None,
        "midrank_percentile": 0.715 if available else None,
        "warnings": ["multi_geography_context"] if kind == "mcpp" else [],
    }


def _analysis() -> dict[str, object]:
    return {
        "radius_m": 250,
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-12-31",
        "offense_category": "PROPERTY",
        "places": [
            {
                "place_id": "place-1",
                "place_label": "Downtown stop",
                "radius_m": 250,
                "place_incident_count": 12,
                "nearest_incident_m": 42.4,
                "reference_comparisons": [_reference()],
            }
        ],
    }


def test_analysis_csv_matches_reference_circle_detail_without_legacy_statistics():
    text = build_analysis_csv(
        _analysis(),
        analysis_start_date="2024-01-01",
        analysis_end_date="2024-12-31",
        layer="reported",
        offense_subcategory=None,
        nibrs_group=None,
    )
    reader = csv.DictReader(StringIO(text))
    rows = list(reader)

    assert reader.fieldnames == ANALYSIS_COLUMNS
    assert not any(
        forbidden in name
        for name in reader.fieldnames or []
        for forbidden in ("visit", "dwell", "rate_ratio", "adjusted_p")
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["place_id"] == "place-1"
    assert row["place_label"] == "Downtown stop"
    assert row["layer"] == "reported"
    assert row["analysis_start_date"] == "2024-01-01"
    assert row["analysis_end_date"] == "2024-12-31"
    assert row["target_incident_count"] == "12"
    assert row["reference_method"] == "empirical_reference_circles"
    assert row["reference_geography_level"] == "mcpp"
    assert row["reference_label"] == "Downtown Commercial MCPP"
    assert row["reference_available"] == "True"
    assert row["reference_computation"] == "exact"
    assert row["reference_median"] == "8"
    assert row["reference_share_below"] == "0.68"
    assert row["reference_warnings"] == "multi_geography_context"
    assert json.loads(row["reference_geography_components"]) == [
        {
            "center_count": 320,
            "id": "DOWNTOWN COMMERCIAL",
            "label": "Downtown Commercial",
            "weight": 1.0,
        }
    ]


def test_analysis_csv_keeps_zero_count_places_and_blanks_unavailable_distribution():
    analysis = _analysis()
    place = analysis["places"][0]
    assert isinstance(place, dict)
    place.update(
        {
            "place_incident_count": 0,
            "nearest_incident_m": None,
            "reference_comparisons": [_reference(available=False)],
        }
    )

    row = next(
        csv.DictReader(
            StringIO(
                build_analysis_csv(
                    analysis,
                    analysis_start_date="2024-01-01",
                    analysis_end_date="2024-12-31",
                    layer="reported",
                    offense_subcategory=None,
                    nibrs_group=None,
                )
            )
        )
    )

    assert row["target_incident_count"] == "0"
    assert row["nearest_incident_m"] == ""
    assert row["reference_available"] == "False"
    assert row["reference_adequacy_status"] == "insufficient_polygon_coverage"
    assert row["reference_median"] == ""
    assert row["reference_share_below"] == ""


def test_analysis_csv_writes_one_row_per_reference_geography():
    analysis = _analysis()
    place = analysis["places"][0]
    assert isinstance(place, dict)
    place["reference_comparisons"] = [_reference(), _reference("city")]

    rows = list(
        csv.DictReader(
            StringIO(
                build_analysis_csv(
                    analysis,
                    analysis_start_date="2024-01-01",
                    analysis_end_date="2024-12-31",
                    layer="reported",
                    offense_subcategory=None,
                    nibrs_group=None,
                )
            )
        )
    )

    assert [row["reference_geography_level"] for row in rows] == ["mcpp", "city"]
    assert rows[1]["reference_computation"] == "monte_carlo"
    assert rows[1]["reference_monte_carlo_error"] == "0.0196"


def test_analysis_csv_escapes_spreadsheet_formula_text():
    analysis = _analysis()
    place = analysis["places"][0]
    assert isinstance(place, dict)
    place["place_label"] = "=CMD()"

    row = next(
        csv.DictReader(
            StringIO(
                build_analysis_csv(
                    analysis,
                    analysis_start_date="2024-01-01",
                    analysis_end_date="2024-12-31",
                    layer="reported",
                    offense_subcategory=None,
                    nibrs_group=None,
                )
            )
        )
    )

    assert row["place_label"] == "'=CMD()"
