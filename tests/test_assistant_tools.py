from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from app.assistant.tools import AssistantToolError, execute_tool
from app.db import get_sessionmaker
from app.geocoding.providers import GeocodeHit
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from tests.helpers_dashboard import session_with_places_and_beat_crime


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


def test_analyze_places_honors_the_active_layer(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # A 911 call at the same spot as the reported crime, so the layers are distinguishable.
    session.add(
        CrimeIncident(
            id="call-1",
            external_incident_id="call-1",
            source_dataset="seattle_spd_911",
            offense_start_utc=datetime(2024, 1, 12, tzinfo=UTC),
            offense_subcategory="DISTURBANCE - OTHER",
            latitude=47.6101,
            longitude=-122.3301,
        )
    )
    session.commit()
    window = {
        "place_ids": ["place-1"],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }
    try:
        calls = execute_tool(session, user_hash, "analyze_places", {**window, "layer": "calls"})
        reported = execute_tool(
            session, user_hash, "analyze_places", {**window, "layer": "reported"}
        )
    finally:
        session.close()

    calls_ids = {i["incident_id"] for i in calls["result"]["incidents"]["incidents"]}
    assert calls_ids == {"call-1"}
    assert calls["result"]["settings_used"]["layer"] == "calls"
    reported_ids = {i["incident_id"] for i in reported["result"]["incidents"]["incidents"]}
    assert reported_ids == {"incident-1"}


def test_analyze_places_rejects_unknown_layer(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    try:
        with pytest.raises(AssistantToolError):
            execute_tool(
                session,
                user_hash,
                "analyze_places",
                {
                    "place_ids": ["place-1"],
                    "analysis_start_date": "2024-01-01",
                    "analysis_end_date": "2024-01-31",
                    "radii_m": [250],
                    "layer": "nope",
                },
            )
    finally:
        session.close()


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


def test_get_neighborhood_analysis_exposes_beat_baseline_stats(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    try:
        result = execute_tool(
            session,
            user_hash,
            "get_neighborhood_analysis",
            {
                "place_ids": [place_id],
                "analysis_start_date": "2026-01-01",
                "analysis_end_date": "2026-06-30",
                "radii_m": [250],
            },
        )
    finally:
        session.close()

    assert result["tool_name"] == "get_neighborhood_analysis"
    place = result["result"]["places"][0]
    assert place["beat"] == "M3"
    assert place["baseline_available"] is True
    # The CI / significance / verdict the assistant must interpret are all present.
    for field in ("rate_ratio", "ci_lower", "ci_upper", "adjusted_p_value", "decision"):
        assert field in place


def test_advertised_menu_is_the_six_poc_tools():
    from app.assistant.semantic_layer import AVAILABLE_TOOLS

    names = {tool["name"] for tool in AVAILABLE_TOOLS}
    assert names == {
        "add_place",
        "select_places",
        "analyze_places",
        "compare_places",
        "get_dashboard_summary",
        "suggest_followups",
    }


def test_planning_prompt_requests_statistical_interpretation():
    from app.assistant.prompts import PLANNING_SYSTEM_PROMPT

    text = PLANNING_SYSTEM_PROMPT.lower()
    assert "confidence interval" in text
    assert "statistically significant" in text
    assert "adjusted p-value" in text


def test_planning_prompt_routes_deictic_references_to_selection():
    """"What's near this pin?" must use the current selection, not geocode the
    literal phrase — this failure surfaced live on the hosted-LLM demo."""
    from app.assistant.prompts import PLANNING_SYSTEM_PROMPT

    text = PLANNING_SYSTEM_PROMPT.lower()
    assert '"this pin"' in text
    assert "empty" in text and "queries" in text
    assert "currently selected" in text
    assert "not place names" in text


class _FakeProvider:
    def __init__(self, hits):
        self._hits = hits

    def search(self, query):
        return self._hits


def test_add_place_geocodes_and_creates(tmp_path, monkeypatch):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr(
        "app.assistant.tools.build_provider",
        lambda settings: _FakeProvider(
            [
                GeocodeHit(
                    label="Pike Place Market, Seattle",
                    latitude=47.6097,
                    longitude=-122.3422,
                    source="nominatim",
                )
            ]
        ),
    )
    try:
        result = execute_tool(session, user_hash, "add_place", {"query": "Pike Place Market"})
    finally:
        session.close()
    assert result["tool_name"] == "add_place"
    payload = result["result"]
    assert payload["created"] is True
    assert payload["place"]["display_label"] == "Pike Place Market"
    assert payload["address"] == "Pike Place Market, Seattle"


def test_select_places_resolves_and_passes_mode(tmp_path, monkeypatch):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr(
        "app.assistant.tools.build_provider",
        lambda settings: _FakeProvider([]),  # "Library stop" already exists, no geocode needed
    )
    try:
        result = execute_tool(
            session, user_hash, "select_places", {"queries": ["Library stop"], "mode": "replace"}
        )
    finally:
        session.close()
    assert result["tool_name"] == "select_places"
    assert result["result"]["place_ids"] == ["place-1"]
    assert result["result"]["mode"] == "replace"
    assert "matched" in result["result"]


def test_analyze_places_bundles_neighborhood_and_incidents(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    try:
        result = execute_tool(
            session,
            user_hash,
            "analyze_places",
            {
                "place_ids": [place_id],  # no queries -> use selection
                "analysis_start_date": "2026-01-01",
                "analysis_end_date": "2026-06-30",
                "radii_m": [250],
            },
        )
    finally:
        session.close()
    payload = result["result"]
    assert result["tool_name"] == "analyze_places"
    assert payload["place_ids"] == [place_id]
    assert payload["settings_used"]["radius_m"] == 250
    assert payload["analysis"]["summary_count"] >= 1
    assert payload["neighborhood"]["places"][0]["beat"] == "M3"
    assert "incidents" in payload
    assert payload["created"] == []
    assert payload["unresolved"] == []


def test_compare_places_by_name_persists_analysis_and_compares(tmp_path, monkeypatch):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # Add a second place so a comparison is possible.
    session.add(
        PlaceCluster(
            id="place-2",
            user_id_hash=user_hash,
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.62,
            centroid_longitude=-122.34,
            display_latitude=47.62,
            display_longitude=-122.34,
            visit_count=1,
            sensitivity_class="normal",
            display_label="Second stop",
            inferred_place_type="manual_place",
            label_source="manual",
        )
    )
    session.commit()
    monkeypatch.setattr("app.assistant.tools.build_provider", lambda settings: _FakeProvider([]))
    try:
        result = execute_tool(
            session,
            user_hash,
            "compare_places",
            {
                "queries": ["Library stop", "Second stop"],
                "analysis_start_date": "2024-01-01",
                "analysis_end_date": "2024-01-31",
                "radius_m": 250,
                "offense_category": "PROPERTY",
            },
        )
    finally:
        session.close()
    payload = result["result"]
    assert result["tool_name"] == "compare_places"
    assert sorted(payload["place_ids"]) == ["place-1", "place-2"]
    assert payload["settings_used"]["radius_m"] == 250
    assert "comparison" in payload
    assert payload["created"] == []
    assert payload["unresolved"] == []


def test_compare_places_requires_two_places(tmp_path, monkeypatch):
    from app.assistant.tools import AssistantClarification

    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr("app.assistant.tools.build_provider", lambda settings: _FakeProvider([]))
    try:
        with pytest.raises(AssistantClarification):
            execute_tool(
                session,
                user_hash,
                "compare_places",
                {
                    "queries": ["Library stop"],
                    "analysis_start_date": "2024-01-01",
                    "analysis_end_date": "2024-01-31",
                    "radius_m": 250,
                },
            )
    finally:
        session.close()


def test_add_place_clarifies_when_not_found(tmp_path, monkeypatch):
    from app.assistant.tools import AssistantClarification

    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr("app.assistant.tools.build_provider", lambda settings: _FakeProvider([]))
    try:
        with pytest.raises(AssistantClarification):
            execute_tool(session, user_hash, "add_place", {"query": "Nonexistent Florble Cafe"})
    finally:
        session.close()


def test_analyze_places_clarifies_without_place(tmp_path, monkeypatch):
    from app.assistant.tools import AssistantClarification

    session, user_hash = _session_with_place_and_crime(tmp_path)
    monkeypatch.setattr("app.assistant.tools.build_provider", lambda settings: _FakeProvider([]))
    try:
        with pytest.raises(AssistantClarification):
            execute_tool(
                session,
                user_hash,
                "analyze_places",
                {
                    "queries": [],
                    "place_ids": [],
                    "analysis_start_date": "2024-01-01",
                    "analysis_end_date": "2024-01-31",
                    "radii_m": [250],
                },
            )
    finally:
        session.close()

