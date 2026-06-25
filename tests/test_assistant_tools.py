from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from app.assistant.tools import AssistantToolError, execute_tool
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster


def _session_with_place_and_crime(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "user-1"
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
            sensitivity_class="normal",
            display_label="Library stop",
            inferred_place_type="manual_place",
            label_source="test",
        )
    )
    session.add(
        CrimeIncident(
            id="incident-1",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.6101,
            longitude=-122.3301,
        )
    )
    session.commit()
    return session, user_hash


def test_unknown_tool_is_rejected(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    try:
        with pytest.raises(AssistantToolError):
            execute_tool(session, user_hash, "raw_sql", {})
    finally:
        session.close()


def test_suggest_followups_returns_deterministic_questions(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    try:
        result = execute_tool(session, user_hash, "suggest_followups", {})
    finally:
        session.close()

    assert result["tool_name"] == "suggest_followups"
    assert result["result"]["suggestions"]
    assert any("compare" in suggestion.lower() for suggestion in result["result"]["suggestions"])


def test_run_place_analysis_delegates_to_existing_service(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    try:
        result = execute_tool(
            session,
            user_hash,
            "run_place_analysis",
            {
                "place_ids": ["place-1"],
                "analysis_start_date": date(2024, 1, 1),
                "analysis_end_date": date(2024, 1, 31),
                "radii_m": [250],
                "offense_category": "PROPERTY",
            },
        )
    finally:
        session.close()

    assert result["tool_name"] == "run_place_analysis"
    assert result["result"]["summary_count"] == 1


def test_get_incident_details_caps_limit_for_agent_path(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    try:
        result = execute_tool(
            session,
            user_hash,
            "get_incident_details",
            {
                "place_ids": ["place-1"],
                "analysis_start_date": "2024-01-01",
                "analysis_end_date": "2024-01-31",
                "radii_m": [250],
                "limit": 500,
                "offense_category": "PROPERTY",
            },
        )
    finally:
        session.close()

    assert result["tool_name"] == "get_incident_details"
    assert result["arguments"]["limit"] == 100
    assert result["result"]["limit"] == 100
    assert result["result"]["total_count"] == 1

