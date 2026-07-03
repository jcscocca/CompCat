from datetime import UTC, date, datetime

from app.analysis.exposure import (
    analysis_days,
    count_incidents_in_place_buffer,
    place_exposure_square_km_days,
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
