"""CSV formula injection in the Tableau export.

display_label is user-supplied and offense fields come from upstream Socrata, so a cell
starting with = + @ (or a leading tab/CR) is executed as a formula when the export is
opened in Excel/Sheets. Those get a leading apostrophe; ordinary text and numeric
columns must pass through untouched.
"""

from __future__ import annotations

from datetime import date

from app.exports.tableau import build_place_summary_csv
from app.schemas import PlaceClusterData, PlaceCrimeSummaryData


def _cluster(label: str) -> PlaceClusterData:
    return PlaceClusterData(
        id="cluster-1",
        user_id_hash="user-hash",
        cluster_version="v1",
        cluster_method="pure_python_radius",
        centroid_latitude=47.609512,
        centroid_longitude=-122.333123,
        display_latitude=47.61,
        display_longitude=-122.333,
        cluster_radius_m=30,
        visit_count=3,
        total_dwell_minutes=90,
        median_dwell_minutes=30,
        display_label=label,
    )


def _summary(category: str = "PROPERTY") -> PlaceCrimeSummaryData:
    return PlaceCrimeSummaryData(
        id="summary-1",
        user_id_hash="user-hash",
        place_cluster_id="cluster-1",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category=category,
        offense_subcategory="THEFT",
        incident_count=2,
    )


def _data_row(csv_text: str) -> str:
    return csv_text.splitlines()[1]


def test_formula_label_is_escaped():
    payload = '=cmd|\'/c calc\'!A1'
    csv_text = build_place_summary_csv([_cluster(payload)], [_summary()])
    row = _data_row(csv_text)
    assert "'=cmd" in row
    # The raw formula must not survive as the leading character of the cell.
    assert ",=cmd" not in row


def test_plus_at_tab_and_cr_prefixes_are_escaped():
    for payload in ("+1+1", "@SUM(A1)", "\tlead", "\rlead"):
        csv_text = build_place_summary_csv([_cluster(payload)], [_summary()])
        assert f"'{payload}" in csv_text


def test_leading_dash_label_is_untouched():
    csv_text = build_place_summary_csv([_cluster("-- home --")], [_summary()])
    assert "-- home --" in csv_text
    assert "'-- home --" not in csv_text


def test_negative_longitude_is_untouched():
    csv_text = build_place_summary_csv([_cluster("Recurring area")], [_summary()])
    row = _data_row(csv_text)
    assert "-122.333" in row
    assert "'-122.333" not in row


def test_upstream_offense_category_is_escaped():
    csv_text = build_place_summary_csv([_cluster("Recurring area")], [_summary("=EVIL()")])
    assert "'=EVIL()" in csv_text
