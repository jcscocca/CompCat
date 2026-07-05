from datetime import date
from math import pi

import pytest

from app.analysis.beat_baselines import buffer_beat_overlap_km2
from app.services.neighborhood_service import neighborhood_analysis_for_places
from tests.helpers_dashboard import (
    session_with_places_and_beat_crime,
    square_beat_polygons,
)

# The shared fixture's place sits at (47.60945, -122.33595); a synthetic square labelled
# "M3" (the beat the real polygons also resolve that point to) pins the point-in-polygon
# beat assignment deterministically, without loading the real geometry.
_M3_POLYGONS = square_beat_polygons("M3", 47.60945, -122.33595)


def test_known_beat_returns_place_and_beat_rates(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={"M3": 3.0},
        beat_polygons=_M3_POLYGONS,
    )
    place = result["places"][0]
    assert place["beat"] == "M3"
    assert place["baseline_available"] is True
    assert place["place_rate"] > 0 and place["beat_rate"] > 0


def test_unknown_beat_marks_baseline_unavailable(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={},
        beat_polygons=_M3_POLYGONS,
    )
    assert result["places"][0]["baseline_available"] is False


def test_place_outside_all_beat_polygons_marks_baseline_unavailable(tmp_path):
    # When a place falls outside every beat polygon, point-in-polygon returns no beat
    # and the baseline is unavailable — even when the area lookup is fully populated.
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={"M3": 3.0},
        beat_polygons=square_beat_polygons("M3", 30.0, -100.0),  # far from the place
    )
    place = result["places"][0]
    assert place["beat"] is None
    assert place["baseline_available"] is False


def test_short_range_returns_insufficient_data(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 6, 1),
        analysis_end_date=date(2026, 6, 10),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={"M3": 3.0},
        beat_polygons=_M3_POLYGONS,
    )
    assert result["places"][0]["decision"] == "insufficient_data"


def test_baseline_excludes_place_buffer_incidents(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M3": 3.0}, beat_polygons=_M3_POLYGONS,
    )
    place = result["places"][0]
    # 5 incidents are within the 250 m buffer; 8 are elsewhere in beat M3.
    # The baseline is now the REST of the beat, so the 5 are carved out.
    assert place["place_incident_count"] == 5
    assert place["beat_incident_count"] == 8
    assert place["baseline_available"] is True
    assert place["exact_p_value"] is not None


def test_oversized_buffer_marks_baseline_too_small(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M3": 0.1},  # buffer (~0.196 km^2) is larger than the beat
        beat_polygons=_M3_POLYGONS,
    )
    place = result["places"][0]
    assert place["minimum_data_status"] == "baseline_too_small"
    assert place["decision"] == "insufficient_data"


def test_neighborhood_analysis_attaches_temporal_profile(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={"M3": 3.0},
        beat_polygons=_M3_POLYGONS,
    )
    temporal = result["places"][0]["temporal"]
    assert len(temporal["hour_counts"]) == 24
    assert len(temporal["dow_counts"]) == 7
    # The fixture's 5 in-radius "near" incidents are dated datetime(2026, m, 12) -> hour 0.
    assert temporal["total_with_time"] == 5
    assert temporal["hour_counts"][0] == 5
    assert temporal["without_time"] == 0


def test_neighborhood_analysis_attaches_category_breakdown_full_result(tmp_path):
    """Full-result branch: both place and beat incidents present → beat_share is not None."""
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={"M3": 3.0},
        beat_polygons=_M3_POLYGONS,
    )
    place = result["places"][0]
    assert "type_mix" not in place
    bd = place["category_breakdown"]
    assert isinstance(bd, list)
    assert len(bd) >= 1
    # Full result has a real beat baseline → at least one row has non-null beat_share.
    assert any(r["beat_share"] is not None for r in bd)
    # All rows have the required keys.
    for row in bd:
        assert set(row.keys()) == {"label", "place_count", "place_share", "beat_share"}


def test_neighborhood_analysis_attaches_category_breakdown_degraded(tmp_path):
    """Degraded branch (no beat area): baseline is None → all beat_shares are None."""
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={},  # no area → baseline_unavailable branch
        beat_polygons=_M3_POLYGONS,
    )
    place = result["places"][0]
    assert "type_mix" not in place
    bd = place["category_breakdown"]
    assert isinstance(bd, list)
    # No beat baseline → every row has beat_share = None.
    assert all(r["beat_share"] is None for r in bd)


def test_pairwise_decides_on_combined_overdispersion_phi():
    # The neighborhood place-to-place pairwise must use the same overdispersion-aware SE as the
    # Compare tab (build_statistical_comparison), or the two surfaces contradict on the same pair.
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.analysis.rate_tests import compare_incident_rates, dispersion_status
    from app.services.neighborhood_service import _pairwise, _place_exposure_km2_days

    start, end = date(2024, 1, 1), date(2024, 4, 30)
    lat, lon = 47.60945, -122.33595
    clusters = [
        SimpleNamespace(id="a", display_latitude=lat, display_longitude=lon, display_label="A"),
        SimpleNamespace(id="b", display_latitude=lat, display_longitude=lon, display_label="B"),
    ]
    # Both places sit at the same point (every incident in-radius for both), and all incidents
    # land in one month -> the combined monthly series is overdispersed (phi >> 1.2).
    buffered = [
        SimpleNamespace(
            latitude=lat, longitude=lon,
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC), report_utc=None,
        )
        for _ in range(12)
    ]
    days = (end - start).days + 1

    pairs = _pairwise(clusters, buffered, 250, days, start, end)

    assert len(pairs) == 1
    pair = pairs[0]
    exposure = _place_exposure_km2_days(250, days)
    phi = dispersion_status([24, 0, 0, 0]).phi  # each place [12,0,0,0]; combined = 24 in Jan
    expected = compare_incident_rates(
        count_a=12, exposure_a=exposure, count_b=12, exposure_b=exposure, overdispersion_phi=phi
    )
    poisson = compare_incident_rates(
        count_a=12, exposure_a=exposure, count_b=12, exposure_b=exposure
    )
    assert pair["ci_lower"] == expected.ci_lower  # decided on the combined-dispersion phi
    assert pair["ci_upper"] == expected.ci_upper
    assert pair["ci_upper"] > poisson.ci_upper  # phi > 1 widened it vs plain Poisson


def test_rest_of_beat_area_carves_only_the_in_beat_buffer_overlap(tmp_path):
    # A place whose buffer pokes outside its beat must have only the in-beat part of the buffer
    # carved out of the rest-of-beat area — not the whole circle (which understates the rest
    # area and biases the rate ratio low). Pin beat_rate to the overlap-based rest area.
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place_lat, place_lon = 47.60945, -122.33595
    # A small beat square so the 250 m buffer extends past its edges (the boundary case).
    beat_polygons = square_beat_polygons("M3", place_lat, place_lon, half=0.0018)
    start, end = date(2026, 1, 1), date(2026, 6, 30)

    result = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_hash,
        place_ids=[place_id],
        radius_m=250,
        analysis_start_date=start,
        analysis_end_date=end,
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
        area_lookup={"M3": 1.0},
        beat_polygons=beat_polygons,
    )

    place = result["places"][0]
    assert place["baseline_available"] is True
    overlap = buffer_beat_overlap_km2(
        lon=place_lon, lat=place_lat, radius_m=250, beat_polygons_for_beat=beat_polygons["M3"]
    )
    assert 0.0 < overlap < pi * 250 * 250 / 1_000_000.0  # a partial buffer, not the whole circle
    days = (end - start).days + 1
    expected_beat_rate = place["beat_incident_count"] / ((1.0 - overlap) * days)
    assert place["beat_rate"] == pytest.approx(expected_beat_rate, rel=1e-9)
