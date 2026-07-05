import sqlite3
from math import cos, pi, radians
from pathlib import Path

import pytest

from app.analysis.beat_baselines import (
    NON_GEOGRAPHIC_BEATS,
    buffer_beat_overlap_km2,
    load_beat_areas,
    missing_beat_areas,
    neighborhood_decision,
    place_vs_beat,
)

DEV_DB = Path(__file__).resolve().parent.parent / "dev-output" / "mobility.sqlite3"

_SEATTLE_LAT, _SEATTLE_LON = 47.61, -122.34


def _metric_square(clon: float, clat: float, half_m: float):
    """A square beat polygon of half-side ``half_m`` metres centred at ``(clon, clat)``, built
    with the same metre↔degree conversion the overlap sampler uses."""
    dlat = half_m / 111_320.0
    dlon = half_m / (111_320.0 * cos(radians(clat)))
    ring = [
        (clon - dlon, clat - dlat),
        (clon + dlon, clat - dlat),
        (clon + dlon, clat + dlat),
        (clon - dlon, clat + dlat),
        (clon - dlon, clat - dlat),
    ]
    return [[ring]]


def _circle_km2(radius_m: float) -> float:
    return pi * radius_m * radius_m / 1_000_000.0


def test_buffer_beat_overlap_full_when_buffer_inside_beat():
    beat = _metric_square(_SEATTLE_LON, _SEATTLE_LAT, half_m=1000)
    overlap = buffer_beat_overlap_km2(
        lon=_SEATTLE_LON, lat=_SEATTLE_LAT, radius_m=250, beat_polygons_for_beat=beat
    )
    assert overlap == pytest.approx(_circle_km2(250))  # every sample inside -> exact full circle


def test_buffer_beat_overlap_half_when_centre_on_beat_edge():
    # Buffer centred on the east edge of a large beat: the west half is inside, east half out.
    east_edge_lon = _SEATTLE_LON + 1000 / (111_320.0 * cos(radians(_SEATTLE_LAT)))
    beat = _metric_square(_SEATTLE_LON, _SEATTLE_LAT, half_m=1000)
    overlap = buffer_beat_overlap_km2(
        lon=east_edge_lon, lat=_SEATTLE_LAT, radius_m=250, beat_polygons_for_beat=beat
    )
    assert overlap == pytest.approx(0.5 * _circle_km2(250), abs=0.04 * _circle_km2(250))


def test_buffer_beat_overlap_quarter_when_centre_on_beat_corner():
    corner_lon = _SEATTLE_LON + 1000 / (111_320.0 * cos(radians(_SEATTLE_LAT)))
    corner_lat = _SEATTLE_LAT + 1000 / 111_320.0
    beat = _metric_square(_SEATTLE_LON, _SEATTLE_LAT, half_m=1000)
    overlap = buffer_beat_overlap_km2(
        lon=corner_lon, lat=corner_lat, radius_m=250, beat_polygons_for_beat=beat
    )
    assert overlap == pytest.approx(0.25 * _circle_km2(250), abs=0.05 * _circle_km2(250))


def test_buffer_beat_overlap_zero_when_buffer_outside_beat():
    beat = _metric_square(_SEATTLE_LON, _SEATTLE_LAT, half_m=1000)
    far_lon = _SEATTLE_LON + 5000 / (111_320.0 * cos(radians(_SEATTLE_LAT)))
    overlap = buffer_beat_overlap_km2(
        lon=far_lon, lat=_SEATTLE_LAT, radius_m=250, beat_polygons_for_beat=beat
    )
    assert overlap == 0.0  # no sample inside


def _write_csv(tmp_path, rows):
    path = tmp_path / "areas.csv"
    path.write_text("beat,area_km2\n" + "".join(f"{b},{a}\n" for b, a in rows), encoding="utf-8")
    return path


def test_load_beat_areas_returns_positive_floats(tmp_path):
    path = _write_csv(tmp_path, [("K3", "3.10"), ("Q3", "2.04")])
    areas = load_beat_areas(path)
    assert areas == {"K3": 3.10, "Q3": 2.04}


def test_load_beat_areas_rejects_nonpositive(tmp_path):
    path = _write_csv(tmp_path, [("K3", "0")])
    with pytest.raises(ValueError):
        load_beat_areas(path)


def test_missing_beat_areas_reports_uncovered():
    areas = {"K3": 3.1}
    assert missing_beat_areas(["K3", "Q3", None, "Q3"], areas) == {"Q3"}


def test_missing_beat_areas_skips_non_geographic_sentinels():
    # "-" (untagged) and "OOJ" (out-of-jurisdiction) are placeholder codes, not real
    # police beats, so they have no polygon and must not be flagged as missing coverage.
    areas = {"K3": 3.1}
    assert missing_beat_areas(["K3", "-", "OOJ"], areas) == set()
    assert {"-", "OOJ"} <= NON_GEOGRAPHIC_BEATS


def test_shipped_csv_loads_and_is_well_formed():
    areas = load_beat_areas()
    assert len(areas) >= 50
    assert all(value > 0 for value in areas.values())
    # Every beat area is a plausible Seattle-scale polygon (downtown beats are sub-km^2;
    # the largest are marine/harbor beats around ~90 km^2), never a degenerate or runaway value.
    assert all(0.1 < value < 150.0 for value in areas.values())
    # K3 is a small dense downtown beat (< 1 km^2); pin it so a wrong endpoint/units regress here.
    assert 0.5 < areas["K3"] < 1.5


def test_decision_above_when_significant_and_high_ratio():
    assert neighborhood_decision(rate_ratio=4.0, adjusted_p_value=0.002,
                                 minimum_data_met=True, model_warning=False) == "above_clear"


def test_decision_below_when_significant_and_low_ratio():
    assert neighborhood_decision(rate_ratio=0.5, adjusted_p_value=0.01,
                                 minimum_data_met=True, model_warning=False) == "below_clear"


def test_decision_not_clear_when_insignificant():
    assert neighborhood_decision(rate_ratio=4.0, adjusted_p_value=0.20,
                                 minimum_data_met=True, model_warning=False) == "not_clear"


def test_decision_insufficient_data_dominates():
    assert neighborhood_decision(rate_ratio=4.0, adjusted_p_value=0.001,
                                 minimum_data_met=False, model_warning=False) == "insufficient_data"


def test_place_vs_beat_reports_ratio_and_above():
    result = place_vs_beat(
        place_count=12, place_exposure=18.0,
        beat_count=60, beat_exposure=360.0,
        combined_monthly_counts=[6, 7, 5, 8, 6, 9, 7, 8, 6, 7, 8, 5],
        analysis_days=180,
    )
    assert round(result.rate_ratio, 1) == 4.0
    assert result.decision == "above_clear"
    assert result.ci_lower > 1.0


@pytest.mark.skipif(not DEV_DB.exists(), reason="dev DB not present")
def test_shipped_csv_covers_every_real_beat_in_dev_db():
    con = sqlite3.connect(DEV_DB)
    try:
        db_beats = [
            row[0]
            for row in con.execute(
                "SELECT DISTINCT beat FROM crime_incidents WHERE beat IS NOT NULL AND beat<>''"
            )
        ]
    finally:
        con.close()
    assert missing_beat_areas(db_beats, load_beat_areas()) == set()
