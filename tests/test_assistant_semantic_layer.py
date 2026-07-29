from __future__ import annotations

from datetime import date
from pathlib import Path

from app.assistant.schemas import AssistantDashboardState
from app.assistant.semantic_layer import _crime_summaries, build_semantic_context
from app.config import get_settings
from app.db import get_sessionmaker
from app.main import create_app
from app.models import AnalysisRun, PlaceCluster, PlaceCrimeSummary

FIXTURES = Path(__file__).parent / "fixtures"


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
    run = AnalysisRun(
        user_id_hash=user_hash,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m_json="[500]",
    )
    session.add(run)
    session.flush()
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
            analysis_run_id=run.id,
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


def test_crime_summaries_scopes_to_latest_run_not_all_runs(tmp_path):
    """_crime_summaries must return only the latest run's rows, not all rows."""
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    user_hash = "user-scope-test"
    session = get_sessionmaker()()

    session.add(
        PlaceCluster(
            id="place-scope",
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
            display_label="Scope test place",
            inferred_place_type="manual_place",
            label_source="test",
        )
    )

    # Run 1 — 3 incidents
    run1 = AnalysisRun(
        user_id_hash=user_hash,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m_json="[250]",
    )
    session.add(run1)
    session.flush()
    session.add(
        PlaceCrimeSummary(
            id="summary-run1",
            user_id_hash=user_hash,
            place_cluster_id="place-scope",
            radius_m=250,
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            incident_count=3,
            nearest_incident_m=80,
            analysis_run_id=run1.id,
        )
    )

    # Run 2 (newer) — 7 incidents
    run2 = AnalysisRun(
        user_id_hash=user_hash,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m_json="[500]",
    )
    session.add(run2)
    session.flush()
    session.add(
        PlaceCrimeSummary(
            id="summary-run2",
            user_id_hash=user_hash,
            place_cluster_id="place-scope",
            radius_m=500,
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            incident_count=7,
            nearest_incident_m=120,
            analysis_run_id=run2.id,
        )
    )
    session.commit()

    summaries = _crime_summaries(session, user_hash, [])

    # Read attributes while session is still open
    summary_count = len(summaries)
    incident_count = summaries[0].incident_count if summaries else None
    run_id_returned = summaries[0].analysis_run_id if summaries else None
    run2_id = run2.id

    session.close()

    # Must return only run2's row (1 row, 7 incidents), not both rows (2 rows, 10 total)
    assert summary_count == 1, f"Expected 1 summary (latest run only), got {summary_count}"
    assert incident_count == 7
    assert run_id_returned == run2_id


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


def test_policy_caveats_frame_the_three_layers_including_arrests():
    from app.assistant.semantic_layer import POLICY_CAVEATS

    text = " ".join(POLICY_CAVEATS).lower()
    # Reported is crime reports only (arrests are no longer unioned into it).
    assert "crime + arrests" not in text
    # Each layer is named and arrests are framed as enforcement, not incidents.
    assert "arrests" in text
    assert "enforcement" in text
    assert "911 calls" in text or "calls for service" in text



def test_dashboard_state_coerces_an_unknown_layer_to_reported():
    # The layer decides what every count MEANS (reports vs arrests vs calls), so an
    # unrecognized value must never reach the tools and silently mislabel results.
    from app.assistant.agent import _tool_arguments

    assert AssistantDashboardState(layer="calls").layer == "calls"
    assert AssistantDashboardState(layer="pwned").layer == "reported"
    assert AssistantDashboardState(layer=None).layer == "reported"
    assert AssistantDashboardState(layer=17).layer == "reported"

    state = AssistantDashboardState(selected_place_ids=["p1"], radii_m=[250], layer="bogus")
    assert _tool_arguments("analyze_places", state, {})["layer"] == "reported"


def test_unknown_layer_log_value_is_truncated(caplog):
    value = "unknown-" + "x" * 500

    AssistantDashboardState(layer=value)

    assert value not in caplog.text
    assert "unknown-" in caplog.text
    assert "x" * 81 not in caplog.text


def test_semantic_context_marks_active_empty_layer_as_not_loaded(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()

    packet = build_semantic_context(
        session,
        "user-empty-layer",
        AssistantDashboardState(
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            radii_m=[250],
            layer="calls",
        ),
        get_settings(),
    )
    session.close()

    message = " ".join(packet.missing_context).lower()
    assert "911 calls" in message
    assert "not loaded" in message
    assert "zero" in message


def test_dashboard_state_bounds_every_field():
    """dashboard_state was entirely unbounded, so a multi-megabyte one validated and was
    interpolated into the planning prompt and sent upstream BEFORE any budget accounting —
    a bypass of the per-message ceiling by orders of magnitude. It also overflowed SQL bind
    parameters in semantic_layer's .in_() lookup."""
    import pytest
    from pydantic import ValidationError

    # A realistic state still validates.
    state = AssistantDashboardState(
        selected_place_ids=["3f2a71c4-1f0e-4a55-9b31-5c9d0f7e2a11"],
        radii_m=[250],
        offense_category="PROPERTY",
        layer="calls",
    )
    assert state.radii_m == [250]

    oversized = [
        {"selected_place_ids": [f"place-{index}" for index in range(30_000)]},
        {"selected_place_ids": ["x" * 5_000]},
        {"radii_m": [250, 500, 750, 1000]},
        {"radii_m": [10**9]},
        {"offense_category": "x" * 5_000},
        {"offense_subcategory": "x" * 5_000},
        {"nibrs_group": "x" * 5_000},
    ]
    for payload in oversized:
        with pytest.raises(ValidationError):
            AssistantDashboardState(**payload)


def test_multi_megabyte_dashboard_state_is_rejected():
    import pytest
    from pydantic import ValidationError

    # ~30 MB, the shape measured in the audit: enough ids, each long enough, to blow the
    # planning prompt past seven million tokens.
    with pytest.raises(ValidationError):
        AssistantDashboardState(selected_place_ids=["x" * 10_000] * 3_000)
