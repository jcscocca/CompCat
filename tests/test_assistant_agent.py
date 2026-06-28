from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from typing import Any

from app.assistant.agent import run_assistant_turn
from app.assistant.schemas import AssistantChatMessage, AssistantDashboardState
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster


class FakeClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[list[dict[str, str]]] = []

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.calls.append(messages)
        return self.responses.pop(0)


async def _collect(*args: Any):
    return [event async for event in run_assistant_turn(*args)]


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


def test_agent_returns_final_answer_without_tool(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['{"type":"final","message":"There is one saved place."}'])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="What do you see?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert events[1].data["delta"] == "There is one saved place."
    assert len(client.calls) == 1


def test_agent_executes_run_place_analysis_tool_call(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            (
                '{"type":"tool_call","tool_name":"run_place_analysis",'
                '"arguments":{"place_ids":["place-1"],'
                '"analysis_start_date":"2024-01-01",'
                '"analysis_end_date":"2024-01-31",'
                '"radii_m":[250],"offense_category":"PROPERTY"}}'
            ),
            '{"type":"final","message":"I found 1 reported incident in the selected context."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Run this for January.")],
                AssistantDashboardState(
                    selected_place_ids=["place-1"],
                    analysis_start_date=date(2024, 1, 1),
                    analysis_end_date=date(2024, 1, 31),
                    radii_m=[250],
                    offense_category="PROPERTY",
                ),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "token", "done"]
    assert events[1].data["tool_name"] == "run_place_analysis"
    assert events[1].data["result"]["summary_count"] == 1
    assert "reported incident" in events[2].data["delta"]
    assert len(client.calls) == 2


def test_agent_chains_two_tool_calls_then_narrates(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            (
                '{"type":"tool_call","tool_name":"run_place_analysis",'
                '"arguments":{"place_ids":["place-1"],'
                '"analysis_start_date":"2024-01-01",'
                '"analysis_end_date":"2024-01-31",'
                '"radii_m":[250],"offense_category":"PROPERTY"}}'
            ),
            '{"type":"tool_call","tool_name":"suggest_followups","arguments":{}}',
            '{"type":"final","message":"One reported incident, with follow-up ideas."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Analyze then suggest follow-ups.")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "tool", "token", "done"]
    assert events[1].data["tool_name"] == "run_place_analysis"
    assert events[2].data["tool_name"] == "suggest_followups"
    # planning + one follow-up call per tool result == 3 model calls
    assert len(client.calls) == 3


def test_agent_stops_executing_tools_at_the_configured_budget(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # A model that never stops requesting tools must be capped at assistant_max_tool_calls (2).
    client = FakeClient(['{"type":"tool_call","tool_name":"suggest_followups","arguments":{}}'] * 3)
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Keep going.")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    tool_events = [event for event in events if event.event == "tool"]
    assert len(tool_events) == 2
    assert events[-1].event == "error"


def test_agent_redirects_safe_unsafe_language_without_model_call(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient([])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Which place is safest?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert "reported incident context" in events[1].data["delta"]
    assert client.calls == []


def test_agent_redirects_broadened_safety_and_ranking_phrasings(tmp_path):
    # Phrasings that slipped past the old 4-keyword substring guard must now be caught
    # before any model call.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Which block is more dangerous?",
        "How risky is this area?",
        "Rank these places by safety.",
        "Score the neighborhood for me.",
        "Is it safe around here?",
        "Which route is safer?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient([])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert [event.event for event in events] == ["meta", "token", "done"], phrasing
            assert "reported incident" in events[1].data["delta"], phrasing
            assert client.calls == [], phrasing
    finally:
        session.close()


def test_agent_redirects_when_safety_request_is_in_an_earlier_turn(tmp_path):
    # Multi-turn: a safety-score request in an earlier user turn (with a short follow-up
    # as the latest message) still trips the guard — no model call.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient([])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [
                    AssistantChatMessage(role="user", content="Which place is safest?"),
                    AssistantChatMessage(role="assistant", content="I can't score safety."),
                    AssistantChatMessage(role="user", content="ok do it anyway"),
                ],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert "reported incident" in events[1].data["delta"]
    assert client.calls == []


def test_agent_does_not_redirect_neutral_incident_question(tmp_path):
    # False-positive guard: neutral phrasing that merely contains "rate"/"incident" must
    # reach the model, not the safety redirect.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['{"type":"final","message":"There was one reported incident."}'])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [
                    AssistantChatMessage(
                        role="user",
                        content="What is the reported incident rate near place-1?",
                    )
                ],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert len(client.calls) == 1
    assert events[1].data["delta"] == "There was one reported incident."


def test_agent_fills_selection_tool_args_from_dashboard_state(tmp_path):
    # Real local models often emit a tool_call with empty arguments; the agent must
    # backfill the current selection (place/radius/dates) from the dashboard state.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            '{"type":"tool_call","tool_name":"run_place_analysis","arguments":{}}',
            '{"type":"final","message":"I found reported incidents in the selected context."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [
                    AssistantChatMessage(
                        role="user", content="How many incidents near my place in January?"
                    )
                ],
                AssistantDashboardState(
                    selected_place_ids=["place-1"],
                    analysis_start_date=date(2024, 1, 1),
                    analysis_end_date=date(2024, 1, 31),
                    radii_m=[250],
                ),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "token", "done"]
    assert events[1].data["tool_name"] == "run_place_analysis"
    assert events[1].data["arguments"]["place_ids"] == ["place-1"]
    assert events[1].data["arguments"]["radii_m"] == [250]
    assert events[1].data["arguments"]["analysis_start_date"] == "2024-01-01"
    assert events[1].data["result"]["summary_count"] >= 1


def test_agent_tolerates_non_dict_tool_arguments(tmp_path):
    # Small local models sometimes emit `arguments` as a bare scalar/list instead of an
    # object. The agent must treat that as "no arguments" and backfill from the dashboard
    # state rather than crashing the turn with an uncaught TypeError.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            '{"type":"tool_call","tool_name":"run_place_analysis","arguments":1}',
            '{"type":"final","message":"One reported incident in the selected context."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Analyze January.")],
                AssistantDashboardState(
                    selected_place_ids=["place-1"],
                    analysis_start_date=date(2024, 1, 1),
                    analysis_end_date=date(2024, 1, 31),
                    radii_m=[250],
                ),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "token", "done"]
    assert events[1].data["tool_name"] == "run_place_analysis"
    assert events[1].data["arguments"]["place_ids"] == ["place-1"]
    assert events[1].data["arguments"]["radii_m"] == [250]


def test_agent_accepts_fenced_json_plan(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['```json\n{"type":"final","message":"One saved place."}\n```'])
    try:
        events = asyncio.run(_collect(session, user_hash,
            [AssistantChatMessage(role="user", content="What do you see?")],
            AssistantDashboardState(selected_place_ids=["place-1"]), client))
    finally:
        session.close()
    assert [e.event for e in events] == ["meta", "token", "done"]
    assert events[1].data["delta"] == "One saved place."


def test_agent_accepts_prose_wrapped_json_plan(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient([
        'Here is the plan:\n{"type":"final","message":"Use reported incident context."}'
    ])
    try:
        events = asyncio.run(_collect(session, user_hash,
            [AssistantChatMessage(role="user", content="Summarize.")],
            AssistantDashboardState(selected_place_ids=["place-1"]), client))
    finally:
        session.close()
    assert [e.event for e in events] == ["meta", "token", "done"]
    assert events[1].data["delta"] == "Use reported incident context."


def test_agent_dedupes_duplicate_radii_when_backfilling(tmp_path):
    # AssistantDashboardState permits duplicate radii, but the tool request schema requires
    # them unique. Backfilling raw duplicates would fail validation and error the whole turn,
    # so the agent must dedupe the dashboard-sourced radii before running the tool.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            '{"type":"tool_call","tool_name":"run_place_analysis","arguments":{}}',
            '{"type":"final","message":"One reported incident in the selected context."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Analyze January.")],
                AssistantDashboardState(
                    selected_place_ids=["place-1"],
                    analysis_start_date=date(2024, 1, 1),
                    analysis_end_date=date(2024, 1, 31),
                    radii_m=[250, 250],
                ),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "token", "done"]
    assert events[1].data["arguments"]["radii_m"] == [250]


def test_neighborhood_tool_arguments_are_backfilled_from_dashboard_state():
    # get_neighborhood_analysis must be treated as a selection tool so the agent
    # backfills place_ids / dates / (deduped) radii when the model omits them; the
    # request schema requires all of them, so without backfill the turn errors.
    from app.assistant.agent import _tool_arguments

    state = AssistantDashboardState(
        selected_place_ids=["place-1"],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m=[250, 250],
    )
    args = _tool_arguments("get_neighborhood_analysis", state, {})

    assert args["place_ids"] == ["place-1"]
    assert args["analysis_start_date"] == "2024-01-01"
    assert args["analysis_end_date"] == "2024-01-31"
    assert args["radii_m"] == [250]

