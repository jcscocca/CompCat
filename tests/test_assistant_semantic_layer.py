from __future__ import annotations

from datetime import date

from app.assistant.schemas import AssistantDashboardState
from app.assistant.semantic_layer import build_semantic_context
from app.config import get_settings
from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster, PlaceCrimeSummary


def test_semantic_context_includes_selected_places_summaries_and_caveats(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    user_hash = "user-1"
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="place-1",
            user_id_hash=user_hash,
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.61,
            centroid_longitude=-122.33,
            display_latitude=47.61,
            display_longitude=-122.33,
            visit_count=3,
            total_dwell_minutes=90,
            median_dwell_minutes=30,
            sensitivity_class="normal",
            display_label="Library stop",
            inferred_place_type="manual_place",
            label_source="test",
        )
    )
    session.add(
        PlaceCrimeSummary(
            id="summary-1",
            user_id_hash=user_hash,
            place_cluster_id="place-1",
            radius_m=500,
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            incident_count=4,
            nearest_incident_m=120,
        )
    )
    session.commit()

    packet = build_semantic_context(
        session,
        user_hash,
        AssistantDashboardState(
            selected_place_ids=["place-1"],
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            radii_m=[500],
        ),
        get_settings(),
    )
    session.close()

    assert packet.dashboard_totals["place_count"] == 1
    assert packet.dashboard_totals["incident_count"] == 4
    assert packet.selected_places[0]["display_label"] == "Library stop"
    assert packet.selected_places[0]["latitude"] == 47.61
    assert packet.crime_summaries[0]["incident_count"] == 4
    assert packet.active_filters["radii_m"] == [500]
    assert any("reported incident" in caveat.lower() for caveat in packet.policy_caveats)
    assert "user-1" not in packet.model_dump_json()


def test_semantic_context_reports_missing_places_selection_dates_and_radius(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()

    packet = build_semantic_context(
        session,
        "user-1",
        AssistantDashboardState(),
        get_settings(),
    )
    session.close()

    assert "No saved places are available." in packet.missing_context
    assert "No places are selected." in packet.missing_context
    assert "No complete analysis date range is selected." in packet.missing_context
    assert "No analysis radius is selected." in packet.missing_context

