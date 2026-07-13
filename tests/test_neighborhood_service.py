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


def test_buffer_larger_than_its_beat_pools_neighboring_beats(tmp_path):
    # The user-reported case: a place in a tiny beat with a radius bigger than the beat. The
    # single-beat rest area would be NEGATIVE (area_lookup 0.05 < in-beat overlap), i.e. the old
    # "too little data" dead end. Pooling the adjacent beat the buffer touches yields a real
    # surrounding area and a verdict.
    from math import cos, radians

    from app.analysis.beat_baselines import beats_intersecting_buffer

    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place_lat, place_lon = 47.60945, -122.33595
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = 111_320.0 * cos(radians(place_lat))
    # M3: a tiny 240 m square around the place (fully inside the 250 m buffer).
    m3_half_m = 120.0
    # M4: a 1 km square adjacent to M3's east edge; the buffer clips its west side.
    m4_half_m = 500.0
    m4_center_lon = place_lon + (m3_half_m + m4_half_m) / meters_per_deg_lon

    def metric_square(clon, clat, half_m):
        dlat, dlon = half_m / meters_per_deg_lat, half_m / meters_per_deg_lon
        ring = [
            (clon - dlon, clat - dlat), (clon + dlon, clat - dlat),
            (clon + dlon, clat + dlat), (clon - dlon, clat + dlat),
            (clon - dlon, clat - dlat),
        ]
        return [[ring]]

    beat_polygons = {
        "M3": metric_square(place_lon, place_lat, m3_half_m),
        "M4": metric_square(m4_center_lon, place_lat, m4_half_m),
    }
    area_lookup = {"M3": 0.05, "M4": 2.0}  # M3's area < its in-buffer overlap (~0.058)
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
        area_lookup=area_lookup,
        beat_polygons=beat_polygons,
    )

    place = result["places"][0]
    assert place["beat"] == "M3"
    assert place["baseline_beats"] == ["M3", "M4"]
    assert place["baseline_available"] is True  # single-beat logic would have been too_small
    overlaps = beats_intersecting_buffer(
        lon=place_lon, lat=place_lat, radius_m=250, beat_polygons=beat_polygons
    )
    assert area_lookup["M3"] - overlaps["M3"] < 0  # proves the single-beat rest was negative
    rest_area = sum(area_lookup.values()) - sum(overlaps.values())
    days = (end - start).days + 1
    # All fixture incidents are DB-tagged beat M3; 5 are in-buffer (carved out), 8 remain.
    assert place["beat_incident_count"] == 8
    assert place["beat_rate"] == pytest.approx(8 / (rest_area * days), rel=1e-9)


def test_buffer_swallowing_every_surrounding_beat_reports_baseline_too_small(tmp_path):
    # The residual fallback: when the buffer covers essentially all of every beat it touches,
    # there is still no surrounding area — the payload flags baseline_too_small (which the UI
    # renders as the "radius too large, try smaller" message) and names the pooled beats.
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M3": 0.1},  # the lone beat's area < the in-buffer overlap (~0.196)
        beat_polygons=square_beat_polygons("M3", 47.60945, -122.33595),
    )
    place = result["places"][0]
    assert place["decision"] == "insufficient_data"
    assert place["minimum_data_status"] == "baseline_too_small"
    assert place["baseline_beats"] == ["M3"]


_MCPP_POLYGONS = square_beat_polygons("TEST HILL", 47.60945, -122.33595)
_MCPP_AREAS = {"TEST HILL": 3.0}


def _run_with_baselines(session, user_hash, place_id, **overrides):
    kwargs = dict(
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
        mcpp_area_lookup=_MCPP_AREAS,
        mcpp_polygons=_MCPP_POLYGONS,
    )
    kwargs.update(overrides)
    return neighborhood_analysis_for_places(**kwargs)


def test_baselines_cover_all_four_kinds(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id)["places"][0]
    by_kind = {entry["kind"]: entry for entry in place["baselines"]}
    assert set(by_kind) == {"mcpp", "beat", "sector", "city"}
    assert by_kind["mcpp"]["label"] == "Test Hill"
    assert by_kind["beat"]["label"] == "Beat M3"
    assert by_kind["sector"]["label"] == "Sector M"
    assert by_kind["city"]["label"] == "Citywide"
    for entry in place["baselines"]:
        assert entry["relation"] in {"above", "similar", "below", "insufficient"}
        assert entry["adjusted_p_value"] >= 0
        assert entry["area_km2"] > 0


def test_baseline_rest_vs_whole_area_counts(tmp_path):
    # Fixture: 5 in-buffer + 8 out-of-buffer incidents, all beat=M3 / mcpp=TEST HILL.
    # mcpp/beat baselines carve out the buffer (rest = 8); sector/city are whole-area (13).
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id)["places"][0]
    by_kind = {entry["kind"]: entry for entry in place["baselines"]}
    assert by_kind["mcpp"]["baseline_incident_count"] == 8
    assert by_kind["beat"]["baseline_incident_count"] == 8
    assert by_kind["sector"]["baseline_incident_count"] == 13
    assert by_kind["city"]["baseline_incident_count"] == 13
    # Whole-area exposure uses the full beat area; the carved baselines use less.
    assert by_kind["city"]["area_km2"] == pytest.approx(3.0)
    assert by_kind["beat"]["area_km2"] < 3.0


def test_baselines_without_mcpp_geography_omit_mcpp(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(
        session, user_hash, place_id, mcpp_area_lookup=None, mcpp_polygons=None
    )["places"][0]
    kinds = {entry["kind"] for entry in place["baselines"]}
    assert kinds == {"beat", "sector", "city"}


def test_baselines_when_place_outside_mcpp_polygons(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(
        session,
        user_hash,
        place_id,
        mcpp_polygons=square_beat_polygons("TEST HILL", 30.0, -100.0),  # far away
    )["places"][0]
    kinds = {entry["kind"] for entry in place["baselines"]}
    assert kinds == {"beat", "sector", "city"}


def test_non_sector_beat_omits_sector_baseline(tmp_path):
    # A lookup keyed by the harbor placeholder "99" has no lettered sector; the city
    # baseline still forms from the full lookup.
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(
        session,
        user_hash,
        place_id,
        area_lookup={"99": 3.0},
        beat_polygons=square_beat_polygons("99", 47.60945, -122.33595),
    )["places"][0]
    kinds = {entry["kind"] for entry in place["baselines"]}
    assert "sector" not in kinds
    assert "city" in kinds


def test_baseline_entries_carry_adjusted_p_and_legacy_fields(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id)["places"][0]
    for entry in place["baselines"]:
        assert 0.0 <= entry["adjusted_p_value"] <= 1.0
    # Legacy top-level beat fields still present and untouched this slice.
    assert place["baseline_available"] is True
    assert "rate_ratio" in place and "beat_rate" in place


def test_place_rate_interval_present_and_ordered(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id)["places"][0]
    assert place["place_rate"] > 0
    assert place["place_rate_ci_lower"] < place["place_rate"] < place["place_rate_ci_upper"]


def test_place_rate_interval_present_without_beat_baseline(tmp_path):
    # Even when no beat baseline forms (empty area lookup), the place's own rate and
    # interval are published — the plot renders the band with whatever ticks exist.
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    place = _run_with_baselines(session, user_hash, place_id, area_lookup={})["places"][0]
    assert place["baseline_available"] is False
    assert place["place_rate"] > 0
    assert place["place_rate_ci_lower"] < place["place_rate_ci_upper"]
