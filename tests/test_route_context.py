from datetime import UTC, date, datetime

from app.routing.context import summarize_route_context
from app.routing.schemas import RouteAlternativeData, RouteSegmentData
from app.schemas import CrimeIncidentData


def test_summarize_route_context_counts_incidents_near_route_segments():
    alternative = RouteAlternativeData(
        id="route-alt-1",
        provider_route_id="mock-1",
        route_label="Transit via Westlake",
        rank=1,
        mode_mix="walk,transit",
        segments=[
            RouteSegmentData(
                id="segment-1",
                route_alternative_id="route-alt-1",
                sequence=1,
                segment_type="transfer",
                mode="walk",
                start_label="Westlake Station",
                start_latitude=47.6116,
                start_longitude=-122.3372,
                end_label="Downtown Seattle",
                end_latitude=47.609,
                end_longitude=-122.335,
            )
        ],
    )
    incidents = [
        CrimeIncidentData(
            offense_start_utc=datetime(2024, 1, 15, 8, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6117,
            longitude=-122.3371,
        )
    ]

    summaries = summarize_route_context(
        user_id_hash="route-user",
        alternatives=[alternative],
        incidents=incidents,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )

    assert len(summaries) == 1
    assert summaries[0].route_alternative_id == "route-alt-1"
    assert summaries[0].context_label == "Westlake Station"
    assert summaries[0].incident_count == 1


def test_summarize_route_context_filters_groups_and_deduplicates_context_points():
    alternatives = [
        RouteAlternativeData(
            id="route-alt-1",
            provider_route_id="mock-1",
            route_label="Transit via Westlake",
            rank=1,
            mode_mix="walk,transit",
            segments=[
                RouteSegmentData(
                    id="segment-1",
                    route_alternative_id="route-alt-1",
                    sequence=1,
                    segment_type="transfer",
                    mode="walk",
                    start_label="Westlake Station",
                    start_latitude=47.6116,
                    start_longitude=-122.3372,
                    end_label="Downtown Seattle",
                    end_latitude=47.609,
                    end_longitude=-122.335,
                ),
                RouteSegmentData(
                    id="segment-2",
                    route_alternative_id="route-alt-1",
                    sequence=2,
                    segment_type="transit",
                    mode="light_rail",
                    start_label="Westlake Station",
                    start_latitude=47.6116,
                    start_longitude=-122.3372,
                    end_label="Capitol Hill Station",
                    end_latitude=47.6191,
                    end_longitude=-122.3208,
                ),
            ],
        ),
        RouteAlternativeData(
            id="route-alt-2",
            provider_route_id="mock-2",
            route_label="Bus via Pine",
            rank=2,
            mode_mix="walk,bus",
        ),
    ]
    incidents = [
        CrimeIncidentData(
            id="crime-1",
            offense_start_utc=datetime(2024, 1, 15, 8, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6117,
            longitude=-122.3371,
        ),
        CrimeIncidentData(
            id="crime-2",
            offense_start_utc=datetime(2024, 1, 16, 8, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6118,
            longitude=-122.337,
        ),
        CrimeIncidentData(
            id="crime-3",
            offense_start_utc=datetime(2024, 1, 16, 8, tzinfo=UTC),
            offense_category="PERSON",
            offense_subcategory="ASSAULT",
            nibrs_group="A",
            latitude=47.6117,
            longitude=-122.3371,
        ),
        CrimeIncidentData(
            id="outside-date",
            offense_start_utc=datetime(2024, 2, 1, 8, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=47.6117,
            longitude=-122.3371,
        ),
        CrimeIncidentData(
            id="missing-coordinate",
            offense_start_utc=datetime(2024, 1, 15, 8, tzinfo=UTC),
            offense_category="PROPERTY",
            offense_subcategory="LARCENY",
            nibrs_group="A",
            latitude=None,
            longitude=-122.3371,
        ),
    ]

    summaries = summarize_route_context(
        user_id_hash="route-user",
        alternatives=alternatives,
        incidents=incidents,
        radii_m=[250],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
    )

    assert len(summaries) == 2
    assert {
        (
            summary.context_label,
            summary.offense_category,
            summary.offense_subcategory,
            summary.nibrs_group,
            summary.incident_count,
            summary.incidents_per_route,
        )
        for summary in summaries
    } == {
        ("Westlake Station", "PROPERTY", "LARCENY", "A", 2, 1),
        ("Westlake Station", "PERSON", "ASSAULT", "A", 1, 0.5),
    }
