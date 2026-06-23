from datetime import UTC, date, datetime

import pytest

from app.analysis.exposure import (
    analysis_days,
    count_incidents_in_place_buffer,
    count_incidents_in_route_corridor,
    parse_route_geometry,
    place_exposure_square_km_days,
    point_to_route_distance_m,
    route_corridor_exposure_square_km_days,
)
from app.schemas import CrimeIncidentData


def test_analysis_days_is_inclusive():
    assert analysis_days(date(2024, 1, 1), date(2024, 1, 30)) == 30


def test_place_exposure_uses_buffer_area_times_days():
    exposure = place_exposure_square_km_days(
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 30),
    )

    assert round(exposure, 3) == 23.562


def test_parse_route_geometry_reads_existing_lat_lon_semicolon_format():
    assert parse_route_geometry("47.1,-122.1;47.2,-122.2") == [
        (47.1, -122.1),
        (47.2, -122.2),
    ]


def test_point_to_route_distance_counts_points_near_segment_not_only_endpoints():
    route = parse_route_geometry("47.6116,-122.3372;47.609,-122.335")
    distance = point_to_route_distance_m(47.6103, -122.3361, route)

    assert distance < 40


def test_route_corridor_exposure_uses_length_buffer_caps_and_days():
    exposure = route_corridor_exposure_square_km_days(
        geometry="47.6116,-122.3372;47.609,-122.335",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 30),
    )

    assert round(exposure, 3) == 10.883


@pytest.mark.parametrize("geometry", [None, "", "47.6116,-122.3372"])
def test_route_corridor_exposure_rejects_missing_or_degenerate_geometry(geometry):
    with pytest.raises(ValueError, match="route geometry requires at least two lat,lon points"):
        route_corridor_exposure_square_km_days(
            geometry=geometry,
            radius_m=250,
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 30),
        )


def test_count_incidents_in_route_corridor_filters_dates_coordinates_and_offense():
    incidents = [
        CrimeIncidentData(
            id="near",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6103,
            longitude=-122.3361,
        ),
        CrimeIncidentData(
            id="wrong-offense",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PERSON",
            offense_subcategory="ASSAULT",
            nibrs_group="A",
            latitude=47.6103,
            longitude=-122.3361,
        ),
        CrimeIncidentData(
            id="outside",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6200,
            longitude=-122.3500,
        ),
        CrimeIncidentData(
            id="out-of-date",
            offense_start_utc=datetime(2023, 12, 31, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6103,
            longitude=-122.3361,
        ),
        CrimeIncidentData(
            id="missing-coordinate",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=None,
            longitude=-122.3361,
        ),
    ]

    result = count_incidents_in_route_corridor(
        incidents=incidents,
        geometry="47.6116,-122.3372;47.609,-122.335",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert [incident.id for incident in result] == ["near"]


@pytest.mark.parametrize("geometry", [None, "", "47.6116,-122.3372"])
def test_count_incidents_in_route_corridor_rejects_missing_or_degenerate_geometry(geometry):
    incidents = [
        CrimeIncidentData(
            id="near",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.6103,
            longitude=-122.3361,
        ),
    ]

    with pytest.raises(ValueError, match="route geometry requires at least two lat,lon points"):
        count_incidents_in_route_corridor(
            incidents=incidents,
            geometry=geometry,
            radius_m=250,
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            offense_category="PROPERTY",
            offense_subcategory=None,
            nibrs_group=None,
        )


def test_count_incidents_in_place_buffer_uses_haversine_distance():
    incidents = [
        CrimeIncidentData(
            id="near",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.6117,
            longitude=-122.3371,
        ),
        CrimeIncidentData(
            id="far",
            offense_start_utc=datetime(2024, 1, 15, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.7000,
            longitude=-122.4000,
        ),
    ]

    result = count_incidents_in_place_buffer(
        incidents=incidents,
        latitude=47.6116,
        longitude=-122.3372,
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
    )

    assert [incident.id for incident in result] == ["near"]
