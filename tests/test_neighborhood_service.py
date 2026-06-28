from datetime import date

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
