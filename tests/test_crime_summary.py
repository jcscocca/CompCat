from datetime import UTC, date, datetime

import pytest

from app.crime.summaries import summarize_place_crime
from app.schemas import CrimeIncidentData, PlaceClusterData


def test_crime_summary_counts_incidents_inside_radius_and_nearest_distance():
    cluster = PlaceClusterData(
        id="cluster-1",
        user_id_hash="user-hash",
        cluster_version="v1",
        cluster_method="pure_python_radius",
        centroid_latitude=47.6095,
        centroid_longitude=-122.3331,
        display_latitude=47.61,
        display_longitude=-122.333,
        cluster_radius_m=30,
        visit_count=3,
        total_dwell_minutes=90,
        median_dwell_minutes=30,
    )
    incidents = [
        CrimeIncidentData(
            id="crime-1",
            offense_start_utc=datetime(2024, 1, 3, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="THEFT",
            nibrs_group="A",
            latitude=47.6101,
            longitude=-122.3330,
        ),
        CrimeIncidentData(
            id="crime-2",
            offense_start_utc=datetime(2024, 1, 3, tzinfo=UTC),
            offense_category="PERSON",
            offense_subcategory="ASSAULT",
            nibrs_group="A",
            latitude=47.6750,
            longitude=-122.3140,
        ),
    ]

    summaries = summarize_place_crime(
        [cluster],
        incidents,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )

    assert len(summaries) == 1
    assert summaries[0].incident_count == 1
    assert summaries[0].offense_category == "PROPERTY"
    assert summaries[0].nearest_incident_m < 20
    assert summaries[0].incidents_per_visit == pytest.approx(1 / (3 * 31 / 7))
    assert summaries[0].incidents_per_hour_dwell == 1 / 1.5


def test_crime_summary_uses_display_coordinates_for_privacy():
    cluster = PlaceClusterData(
        id="cluster-1",
        user_id_hash="user-hash",
        cluster_version="v1",
        cluster_method="manual",
        centroid_latitude=47.6000,
        centroid_longitude=-122.3000,
        display_latitude=47.6100,
        display_longitude=-122.3330,
        cluster_radius_m=30,
        visit_count=1,
    )
    incidents = [
        CrimeIncidentData(
            id="crime-1",
            offense_start_utc=datetime(2024, 1, 3, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.6101,
            longitude=-122.3330,
        )
    ]

    summaries = summarize_place_crime(
        [cluster],
        incidents,
        radii_m=[50],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )

    assert len(summaries) == 1
    assert summaries[0].incident_count == 1


def test_crime_summary_scales_weekly_visits_to_analysis_window():
    cluster = PlaceClusterData(
        id="cluster-weekly",
        user_id_hash="user-hash",
        cluster_version="v1",
        cluster_method="manual_public_dashboard",
        centroid_latitude=47.6095,
        centroid_longitude=-122.3331,
        display_latitude=47.61,
        display_longitude=-122.333,
        cluster_radius_m=30,
        visit_count=3,
        total_dwell_minutes=90,
        median_dwell_minutes=30,
    )
    incidents = [
        CrimeIncidentData(
            id="crime-weekly",
            offense_start_utc=datetime(2024, 1, 3, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="THEFT",
            nibrs_group="A",
            latitude=47.6096,
            longitude=-122.3330,
        ),
    ]

    summaries = summarize_place_crime(
        [cluster],
        incidents,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 28),
    )

    assert len(summaries) == 1
    assert summaries[0].incident_count == 1
    assert summaries[0].incidents_per_visit == 1 / 12
