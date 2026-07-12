from __future__ import annotations

import asyncio
import json
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


def test_agent_runs_workflow_tool_with_deterministic_summary(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # Planning returns a compare_places tool_call; there is NO second model call.
    client = FakeClient(
        [
            '{"type":"tool_call","tool_name":"compare_places","arguments":{}}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Compare my selected places.")],
                AssistantDashboardState(
                    selected_place_ids=["place-1", "place-2"],
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
    assert events[1].data["tool_name"] == "compare_places"
    # the real deterministic compare summary rendered (not the "Done." fallback)
    assert "reported incidents within 250 m" in events[2].data["delta"].lower()
    assert len(client.calls) == 1  # planning only — no narration call


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
    assert "reported incident counts" in events[1].data["delta"]
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


def test_analyze_places_args_are_backfilled_from_dashboard_state():
    from app.assistant.agent import _tool_arguments

    state = AssistantDashboardState(
        selected_place_ids=["place-1"],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m=[250, 250],
        offense_category="PROPERTY",
    )
    # Model named a place -> queries preserved; selection/settings still backfilled.
    args = _tool_arguments("analyze_places", state, {"queries": ["Pike Place"]})

    assert args["queries"] == ["Pike Place"]
    assert args["place_ids"] == ["place-1"]
    assert args["radii_m"] == [250]
    assert args["analysis_start_date"] == "2024-01-01"
    assert args["offense_category"] == "PROPERTY"


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


def test_model_radius_override_beats_dashboard_backfill_compare():
    from app.assistant.agent import _tool_arguments

    state = AssistantDashboardState(
        selected_place_ids=["p1", "p2"],
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 7, 1),
        radii_m=[250],
        layer="reported",
    )
    args = _tool_arguments("compare_places", state, {"radius_m": 500})
    assert args["radius_m"] == 500
    assert args["place_ids"] == ["p1", "p2"]
    assert args["analysis_start_date"] == "2026-01-01"


def test_model_radius_override_beats_dashboard_backfill_analyze():
    from app.assistant.agent import _tool_arguments

    state = AssistantDashboardState(
        selected_place_ids=["p1"],
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 7, 1),
        radii_m=[250],
        layer="reported",
    )
    args = _tool_arguments("analyze_places", state, {"radii_m": [500]})
    assert args["radii_m"] == [500]
    assert args["layer"] == "reported"


def test_agent_clarifies_underspecified_request(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # compare with only one resolvable place -> AssistantClarification -> clarify token, NOT error.
    client = FakeClient(
        [
            '{"type":"tool_call","tool_name":"compare_places",'
            '"arguments":{"queries":["Library stop"]}}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Compare it.")],
                AssistantDashboardState(
                    analysis_start_date=date(2024, 1, 1),
                    analysis_end_date=date(2024, 1, 31),
                    radii_m=[250],
                ),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert "at least two places" in events[1].data["delta"]


def test_agent_reports_unreachable_classifier(tmp_path):
    from app.assistant.llm_client import LlmUnavailable

    class RaisingClient:
        calls: list = []

        async def complete(self, messages, *, role, temperature=None, max_tokens=None):
            raise LlmUnavailable("endpoint down")

    session, user_hash = _session_with_place_and_crime(tmp_path)
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Compare A and B.")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                RaisingClient(),
            )
        )
    finally:
        session.close()

    assert events[-1].event == "error"
    assert "Couldn't reach the analyst" in events[-1].data["message"]


def test_agent_redirects_object_first_ranking_without_safety_words(tmp_path):
    # Object-first ranking phrasings that do NOT contain safety vocabulary ("safe", "danger",
    # "risk") must still trip the pre-LLM guard. These previously bypassed it because the
    # optional determiner clause `(?:these|those|them|the\s+)?` attached the trailing `\s+`
    # only to "the", so "rank these places" never matched the noun that followed.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Rank these places",
        "Rank those neighborhoods",
        "Score these areas",
        "Rate these blocks",
    ]
    try:
        for phrasing in phrasings:
            # The benign final response would only be consumed if the guard wrongly let the
            # turn reach the model; client.calls == [] proves it short-circuited first.
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_assistant_answer_stream_emits_no_safety_ranking_language(tmp_path):
    # Output-side invariant guard: the assistant's *answer* paths (the deterministic tool
    # summaries) must never emit safety-ranking vocabulary. The deliberate refusal message is
    # exempt by design — it explains the refusal *using* those words — so this exercises the
    # answer-producing tool flows, not the refusal path.
    import re as _re

    banned = _re.compile(
        r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|risk(?:y|ier|iest)?)\b",
        _re.IGNORECASE,
    )
    session, user_hash = _session_with_place_and_crime(tmp_path)
    state = AssistantDashboardState(
        selected_place_ids=["place-1", "place-2"],
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        radii_m=[250],
    )
    try:
        for tool_name in ("compare_places", "run_place_analysis"):
            client = FakeClient(
                [f'{{"type":"tool_call","tool_name":"{tool_name}","arguments":{{}}}}']
            )
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content="Summarize the selection.")],
                    state,
                    client,
                )
            )
            deltas = [event.data["delta"] for event in events if event.event == "token"]
            assert deltas, tool_name  # an answer summary was actually streamed
            for delta in deltas:
                assert not banned.search(delta), f"{tool_name}: {delta!r}"
    finally:
        session.close()


def test_agent_redirects_object_first_ranking_with_determiners_and_possessives(tmp_path):
    # #60: the rank/rate/score arm must catch ranking requests regardless of the determiner or
    # possessive before the place-noun. #59 only handled these/those/them/the.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Rate my places",
        "Rank this place",
        "Score all the spots",
        "Rank your neighborhoods",
        "Rate that block",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_additional_safety_synonyms(tmp_path):
    # #60: broadened lexicon — synonyms beyond safe/danger/risk must also trip the guard.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Is this area hazardous?",
        "How perilous is downtown?",
        "Is it crime-free around here?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_allowed_count_or_neutral_phrasings(tmp_path):
    # #60 guard against over-matching: incident-count ranking and neutral phrasings are ALLOWED
    # and must reach the model, not the safety redirect.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Which area has the most crime?",
        "Is my data secure?",
        "What is the reported incident rate near place-1?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing  # reached the model, not the redirect
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_safety_language_in_model_final_message(tmp_path):
    # #60 output-side guard: even when a request slips past the input guard, a model final
    # answer containing safety-ranking language must be replaced with the redirect, not streamed.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['{"type":"final","message":"Area A is safer than Area B."}'])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Where should I walk?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    delta = events[1].data["delta"]
    assert "safer" not in delta  # the model's safety-ranking phrasing must not leak
    assert "reported incident" in delta  # replaced with the standard redirect
    assert len(client.calls) == 1  # the model WAS called (input guard didn't fire)


def test_agent_clarifies_when_date_range_or_radius_missing(tmp_path):
    # #61: a selection-tool call with no date range / radius set must ASK (clarify), not hard-error.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['{"type":"tool_call","tool_name":"analyze_places","arguments":{}}'])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Analyze my places.")],
                AssistantDashboardState(selected_place_ids=["place-1"]),  # no dates, no radii
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]  # clarify, not error
    delta = events[1].data["delta"].lower()
    assert "date" in delta or "radius" in delta


def test_agent_clarifies_empty_select_places_instead_of_wiping(tmp_path):
    # #61: select_places with no queries (non-clear) must clarify, not silently clear the selection.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        ['{"type":"tool_call","tool_name":"select_places",'
         '"arguments":{"queries":[],"mode":"replace"}}']
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="select")],
                AssistantDashboardState(selected_place_ids=["place-1", "place-2"]),
                client,
            )
        )
    finally:
        session.close()

    # A clarification (token/done), never a tool event that would apply replace-with-empty.
    assert [event.event for event in events] == ["meta", "token", "done"]
    assert "tool" not in [event.event for event in events]
    assert events[1].data["delta"]


def test_execute_tool_does_not_double_wrap_assistant_tool_error():
    # #61: an AssistantToolError raised inside execute_tool must propagate as-is, not be
    # re-wrapped by the broad `except ValueError` clause (AssistantToolError subclasses ValueError).
    import pytest

    from app.assistant.tools import AssistantToolError, execute_tool

    with pytest.raises(AssistantToolError) as excinfo:
        execute_tool(None, "user-1", "definitely_not_a_tool", {})
    assert not isinstance(excinfo.value.__cause__, AssistantToolError)


def test_analyze_places_settings_used_matches_bridge_contract(tmp_path):
    # #62: settings_used must echo only the fields the frontend bridge (AnalysisSettings) can
    # apply — radius/date range/offense_category — not offense_subcategory/nibrs_group, which the
    # UI has no control for and the bridge silently dropped. The analysis still honors them as
    # filters; they're simply not surfaced in the settings echo.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['{"type":"tool_call","tool_name":"analyze_places","arguments":{}}'])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Analyze.")],
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

    tool_event = next(event for event in events if event.event == "tool")
    assert set(tool_event.data["result"]["settings_used"]) == {
        "radius_m",
        "analysis_start_date",
        "analysis_end_date",
        "offense_category",
        "layer",
    }


def test_agent_redirects_colloquial_area_judgment_terms(tmp_path):
    # H4: colloquial adjectives that judge a *place's* safety character must trip the guard
    # before any model call. (Event/offense descriptors like "threatening" are deliberately
    # NOT here — see test_agent_does_not_redirect_neutral_spanish_or_incident_terms.)
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Is this a sketchy area?",
        "Is that block shady?",
        "That neighborhood seems dodgy.",
        "Is downtown seedy?",
        "Is it scary here at night?",
        "Is this a frightening part of town?",
        "Is this a ghetto neighborhood?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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

def test_agent_redirects_spanish_safety_phrasings(tmp_path):
    # H4: Spanish safety-ranking requests must trip the deterministic guard (no model call),
    # including the accent-free forms users routinely type.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Qué zona es más segura?",
        "¿Es peligroso este barrio?",
        "¿Qué tan riesgoso es aquí?",
        "que lugar es mas seguro",  # accent-free
        "¿Es inseguro caminar por aquí?",
        "¿Esta zona está libre de crimen?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_spanish_bare_rank_requests(tmp_path):
    # H4: Spanish rank/rate/score verbs targeting a place noun (no safety word present) must
    # trip the guard, mirroring the English object-first rank arm. Includes accent-free forms.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Clasifica estos barrios",
        "Califica estas zonas",
        "Puntúa las rutas",
        "clasifica estas areas",  # accent-free "áreas"
        "Clasifica los lugares por favor",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_neutral_spanish_or_incident_terms(tmp_path):
    # H4 false-positive guard: neutral Spanish incident questions, English event/offense
    # descriptors excluded from the lexicon, and a bare Spanish place noun without a rank verb
    # must all reach the model — not the safety redirect.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Cuántos incidentes en esta zona?",  # neutral Spanish count question
        "How many violent crime incidents near here?",  # 'violent' deliberately excluded
        "Were there any threatening incidents nearby?",  # 'threatening' deliberately excluded
        "¿Cuál es la ruta más rápida?",  # fastest route — place noun w/o rank verb, not safety
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing  # reached the model, not the redirect
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_spanish_safety_language_in_model_final_message(tmp_path):
    # H4 output-side guard: a model final answer containing Spanish safety vocabulary is
    # replaced with the standard redirect, not streamed. The input ("¿Dónde debería caminar?")
    # does NOT trip the input guard, so the model IS called (1 call) and the output guard fires.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        ['{"type":"final","message":"La zona A es más segura que la zona B."}']
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="¿Dónde debería caminar?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    delta = events[1].data["delta"]
    assert "segura" not in delta  # the model's Spanish safety phrasing must not leak
    assert "reported incident" in delta  # replaced with the standard redirect
    assert len(client.calls) == 1  # the model WAS called (input guard didn't fire)


def test_agent_redirects_spanish_idad_noun_forms(tmp_path):
    # H4 follow-up: the canonical Spanish nouns for "safety"/"dangerousness" are seguridad,
    # inseguridad, peligrosidad — a native speaker's default construction is "la seguridad de
    # este barrio", not the adjective form. These must trip the guard.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Cuál es la seguridad de esta zona?",
        "Compara la seguridad de estos barrios",
        "Habla de la inseguridad de este barrio",
        "Compara la peligrosidad de estos barrios",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_latin_american_place_nouns_in_rank_arm(tmp_path):
    # H4 follow-up: the Spanish rank arm must catch Latin-American place-noun variants
    # (colonia, vecindario, sector, distrito, manzana, avenida) — Seattle has a large
    # Mexican-Spanish-speaking population; "colonia" is the standard Mexican word for
    # "neighborhood", "manzana" the standard block term.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "clasifica estas colonias",
        "califica esta colonia",
        "clasifica los vecindarios",
        "clasifica estos sectores",
        "clasifica los distritos",
        "clasifica estas avenidas",
        "clasifica estas manzanas",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_colloquial_comparative_and_superlative_forms(tmp_path):
    # H4 follow-up: comparative/superlative forms of the new colloquial terms
    # (sketchier/sketchiest/shadier/shadiest/dodgier/dodgiest/scariest) are the same
    # place-ranking intent as the base forms and must also trip the guard.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Which block is the sketchiest?",
        "Which neighborhood is shadier?",
        "Which street is scariest at night?",
        "Which spot is dodgiest?",
        "Which area is seediest?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_english_rank_verb_inflections(tmp_path):
    # H4 follow-up: the English rank arm must catch inflected forms (ranking/ranked/rated/
    # scoring) targeting place nouns without a safety word — the Spanish arm already handles
    # this via \w*; symmetry demands the English arm too.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Ranking my neighborhoods",
        "Scoring the areas please",
        "Rated these blocks for me",
        "Ranked my places",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_english_colloquial_proper_nouns(tmp_path):
    # H4 follow-up · Finding 4: English colloquial terms (sketchy/shady/dodgy/seedy/scary/
    # ghetto/frightening) are now context-required — they must NOT trip the guard when they
    # appear as proper nouns without a place-context word.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Show incidents near Shady Grove Ave",
        "Ghetto Gastro pop-up nearby",
        "Dodgy Dogs food truck schedule",
        "Scary Cherry mural tour dates",
        "How was crime in the Warsaw Ghetto in 1943?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing  # reached the model, not the redirect
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_does_not_redirect_spanish_epistemic_filler(tmp_path):
    # H4 follow-up · Finding 3: bare Spanish "seguro"/"segura" as epistemic filler
    # ("I'm sure"/"are you sure") must reach the model. These are common conversational
    # forms with no place-context; they are the direct Spanish analog of "safely"/"Safeway"
    # the English arm already avoids.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Estoy seguro que hubo un incidente anoche",
        "No estoy seguro de la fecha",
        "¿Estás seguro que fue anoche?",
        "Seguro que hay muchos incidentes",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_spanish_colloquial_place_adjectives(tmp_path):
    # H4 follow-up · Finding 1a: Spanish colloquial place-character adjectives
    # (tranquilo/a, conflictivo/a, problemático/a) that describe a place must trip the guard
    # when a place-context word co-occurs. Symmetry with the English colloquial arm.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Es tranquila esta zona?",
        "¿Este barrio es tranquilo?",
        "¿Es un barrio conflictivo?",
        "¿Es una zona conflictiva?",
        "¿Este barrio es problemático?",
        "¿Es problemática esta zona?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_spanish_colloquial_filler(tmp_path):
    # H4 follow-up · Finding 1a allow-list: bare "tranquilo"/"tranquila" as personal state
    # ("I'm calm") must reach the model — same filler shape as "estoy seguro".
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Estoy tranquilo",
        "Estoy tranquila",
        "Mantente tranquilo, por favor",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_spanish_mal_place_compound(tmp_path):
    # H4 follow-up · Finding 1b: "mal barrio"/"mala zona"/"malos vecindarios" are compound
    # judgments with the place noun baked in — unambiguous safety-ranking language, must trip.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Es un mal barrio?",
        "Es una mala zona",
        "Es un mal vecindario",
        "Son malos barrios",
        "Es un mal sector",
        "Es un mal lugar",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_mal_without_place_noun(tmp_path):
    # H4 follow-up · Finding 1b allow-list: "mal + non-place-noun" must reach the model
    # (mala idea = bad idea, mal día = bad day, malos vecinos = bad neighbors — none are
    # place nouns even though "vecinos" is close to "vecindario").
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Fue una mala idea",
        "Un mal día",
        "Tengo malos vecinos",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_mal_place_compound_with_es_plurals(tmp_path):
    # H4 follow-up · Finding 1b (plural fix): consonant-ending place nouns "sector"/"lugar"
    # pluralize with -es, not -s. The mal compound must catch "malos sectores"/"malos
    # lugares" — not just the vowel-ending "-s" plurals.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Son malos sectores",
        "Son malos lugares",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_avoid_evitar_place_requests(tmp_path):
    # H4 follow-up · Finding 2: asking which places to avoid ("¿Qué barrios debo evitar?" /
    # "Which neighborhoods should I avoid?") is asking the assistant to label places unsafe.
    # Both word orders (object-first and verb-first) trip via the ambiguous+context helper.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Qué barrios debo evitar?",
        "¿Qué zonas deberíamos evitar?",
        "evita estos lugares",
        "Which neighborhoods should I avoid?",
        "avoid these places",
        "avoiding the area at night",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_avoid_without_place_context(tmp_path):
    # H4 follow-up · Finding 2 allow-list: "avoid the pothole" / "evita la lluvia" are not
    # place-ranking asks — no place-context word appears, so the ambiguous+context check
    # must NOT trip.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "How do I avoid the pothole?",
        "evita la lluvia",
        "avoid gluten in your diet",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_evitar_finite_inflections(tmp_path):
    # H4 follow-up · Finding 2 (inflection fix): common finite/conditional forms of "evitar"
    # — conditional (evitaría), indicative (evitamos/evitan), preterite (evitó/evitaron),
    # voseo imperative (evitá) — are natural "which places to avoid" asks and must trip when
    # a place-context word co-occurs. The explicit-suffix list missed them.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Qué barrios evitaría?",
        "¿Qué barrios evitarías?",
        "¿Qué zonas evitamos?",
        "¿Qué zonas evitaron?",
        "¿Qué zonas evitan?",
        "evitá estos lugares",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_rank_verb_with_punctuation_before_noun(tmp_path):
    # H4 follow-up · Finding 5: directive-style rank/rate/score with punctuation ("Rank: my
    # places", "Clasifica: estos barrios", "Score, the neighborhoods") bypasses the H4 arms
    # because they hard-require \s+ right after the verb. Widen to a bounded punctuation class.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Rank: my places",
        "Score, the neighborhoods",
        "Rate — these blocks",
        "Clasifica: estos barrios",
        "Puntúa, las rutas",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_h4_phrasings_still_covered_by_helper():
    # H4 follow-up regression pin: the context-scoping refactor must not regress the H4-era
    # phrasings the guard already caught. Direct helper-level check (no session / no LLM).
    from app.assistant.agent import _contains_safety_ranking

    must_trip = [
        # H4 English safety lexicon
        "Which place is safest?",
        "How risky is this area?",
        "Rank these places by safety.",
        "Is this a sketchy area?",
        "Is that block shady?",
        "Which block is the sketchiest?",
        # H4 Spanish safety lexicon (still tripping because place-context is present)
        "¿Qué zona es más segura?",
        "¿Es peligroso este barrio?",
        "¿Es inseguro caminar por aquí?",
        "que lugar es mas seguro",
        "¿Cuál es la seguridad de esta zona?",
        # H4 Spanish rank arm + LatAm variants
        "Clasifica estos barrios",
        "clasifica estas colonias",
        # H4 English rank arm + inflections
        "Rate these blocks",
        "Ranking my neighborhoods",
    ]
    must_pass = [
        # H4 allow-list — neutral/legit incident-context questions
        "What is the reported incident rate near place-1?",
        "Which area has the most crime?",
        "How many violent crime incidents near here?",
        "¿Cuántos incidentes en esta zona?",
        "¿Cuál es la ruta más rápida?",
    ]
    for phrasing in must_trip:
        assert _contains_safety_ranking(phrasing), phrasing
    for phrasing in must_pass:
        assert not _contains_safety_ranking(phrasing), phrasing


def test_agent_over_refuses_estar_seguro_with_place_word_known_limitation(tmp_path):
    # KNOWN, ACCEPTED fail-safe over-refusal. Task 2 moved Spanish "seguro"/"tranquilo" into
    # the ambiguous bundle, so they trip whenever a place-context word co-occurs. Regex cannot
    # reliably separate epistemic "seguro DE X" (sure about) from physical "seguro EN X" (safe
    # in a place) — every attempt to strip the epistemic form introduced a place-safety BYPASS
    # (invariant leak), which is worse than over-refusing. So we ACCEPT that these rare 1st/2nd-
    # person filler phrasings that ALSO name a place get the redirect. Bare "estoy seguro que…"
    # WITHOUT a place word still reaches the model — see
    # test_agent_does_not_redirect_spanish_epistemic_filler.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "No estoy seguro de la ubicación",
        "¿Estás seguro de que fue en este barrio?",
        "Estoy tranquilo en esta zona",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_still_redirects_ser_seguro_place_safety(tmp_path):
    # Final-review fix guard: place-safety with SER must STILL trip — only ESTAR-filler is
    # excluded. These are genuine "is this place safe?" asks.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Es seguro este barrio?",
        "¿Es segura esta zona?",
        "¿Qué tan seguro es este lugar?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_postposed_barrio_malo(tmp_path):
    # Final-review fix: postposed adjective "barrio malo"/"zona mala" is the same place-label
    # as the preposed "mal barrio" (Finding 1b) and must trip — a reordering must not bypass.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Es un barrio malo?",
        "Es una zona mala",
        "Son barrios malos",
        "Es un lugar malo",
        "Es un sector malo",
        "Son sectores malos",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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



def test_agent_redirects_estar_third_person_place_safety(tmp_path):
    # Final-review fix²: Spanish uses ESTAR for a location's safety too — "¿está seguro este
    # barrio?" = "is this neighborhood safe?" is a genuine place-safety ask. The epistemic-
    # filler strip must NOT swallow 3rd-person está/están, or these bypass the guard.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿está seguro este barrio?",
        "¿está segura esta zona?",
        "¿están seguras estas calles?",
        "esta zona está segura",
        "este barrio no está seguro",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_redirects_spanish_centro_esquina_place_context(tmp_path):
    # Final sign-off gap: Spanish place-context omitted "centro" (downtown) and "esquina"
    # (corner) though the English equivalents (downtown/corner) are covered. Ambiguous safety
    # terms co-occurring with centro/esquina must trip, mirroring the English arm.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿es seguro el centro?",
        "el centro es inseguro",
        "evita el centro",
        "¿es segura esta esquina?",
        "evita esta esquina",
        "¿es sketchy el centro?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
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


def test_agent_does_not_redirect_neutral_centro_question(tmp_path):
    # Allow-list: centro/esquina are place-context, not safety terms. A neutral count question
    # naming el centro (no ambiguous safety term) must reach the model.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿cuántos incidentes hubo en el centro?",
        "muéstrame los incidentes en esta esquina",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()


def test_agent_redirects_presence_claim_in_model_final_message(tmp_path):
    # Invariant (presence prong): a model answer asserting the user was present at / witnessed /
    # was victimized by an incident must be replaced with the presence redirect, not streamed.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    claims = [
        "You were present at this incident on January 10th.",
        "Based on your visits, you were robbed near here.",
        "You were a victim of the assault at that corner.",
        "You witnessed a robbery here last week.",
    ]
    try:
        for claim in claims:
            client = FakeClient([f'{{"type":"final","message":{json.dumps(claim)}}}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content="What happened near place-1?")],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            delta = events[1].data["delta"]
            assert "personal presence" in delta, claim  # the standard presence redirect
            assert "robbed" not in delta and "victim" not in delta, claim  # claim did not leak
            assert len(client.calls) == 1, claim  # model WAS called (input guard didn't fire)
    finally:
        session.close()


def test_agent_redirects_presence_question_before_model_call(tmp_path):
    # A user asking to be placed at an incident is short-circuited before the LLM is called.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    questions = [
        "Was I present at any of these incidents?",
        "Have I been a victim of a crime here?",
        "Did I witness the robbery near place-1?",
    ]
    try:
        for question in questions:
            client = FakeClient(['{"type":"final","message":"unused"}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=question)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert [event.event for event in events] == ["meta", "token", "done"], question
            assert "personal presence" in events[1].data["delta"], question
            assert len(client.calls) == 0, question  # redirected without reaching the model
    finally:
        session.close()


def test_agent_does_not_redirect_presence_adjacent_neutral_phrasings(tmp_path):
    # The presence guard must not over-match ordinary "near you" / "a place you visit" phrasing:
    # neutral inputs reach the model, and a neutral model answer streams unchanged.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    neutral_answer = "There are 3 reported incidents near a place you visit."
    inputs = [
        "How many incidents are reported near a place I visit?",
        "Show the incidents near place-1.",
    ]
    try:
        for text in inputs:
            client = FakeClient([f'{{"type":"final","message":{json.dumps(neutral_answer)}}}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=text)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, text  # reached the model, not the redirect
            assert events[1].data["delta"] == neutral_answer, text  # streamed unchanged
    finally:
        session.close()


def test_agent_redirects_non_lexicon_ranking_prose_in_model_answer(tmp_path):
    # Output-side guard: place-ranking / livability prose that carries no banned safety word
    # (so _contains_safety_ranking misses it) must still be replaced, not streamed.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    answers = [
        "This is a bad area to live.",
        "Capitol Hill is the worst of the three.",
        "This block is a high-crime area.",
        "I wouldn't recommend living here.",
        "It's a rough neighborhood.",
    ]
    try:
        for answer in answers:
            client = FakeClient([f'{{"type":"final","message":{json.dumps(answer)}}}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content="Tell me about place-1.")],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            delta = events[1].data["delta"]
            assert "reported incident" in delta, answer  # replaced with the standard redirect
            assert delta != answer, answer  # the ranking prose did not leak
            assert len(client.calls) == 1, answer  # model was called (input guard didn't fire)
    finally:
        session.close()


def test_agent_does_not_redirect_neutral_count_framing_in_model_answer(tmp_path):
    # The output ranking-prose guard must not catch legitimate neutral answers: incident-count
    # comparisons, temporal framing, and "place to..." phrases that aren't about living there.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    neutral_answers = [
        "This area has more reported incidents than the others.",
        "August had the most reported thefts near this place.",
        "There are 4 reported incidents within 250 m of place-1.",
        "This is a good place to start if you want the incident breakdown.",
    ]
    try:
        for answer in neutral_answers:
            client = FakeClient([f'{{"type":"final","message":{json.dumps(answer)}}}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content="Summarize place-1.")],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert events[1].data["delta"] == answer, answer  # streamed unchanged
    finally:
        session.close()


# ---------- narration prompt builders (pure functions) ----------


def test_build_tool_grounding_contains_tool_template_and_result():
    from app.assistant.prompts import build_tool_grounding

    grounding = build_tool_grounding(
        "compare_places",
        "Compared 2 places.",
        {"tool_name": "compare_places", "result": {"verdict": "not_clear"}},
    )
    assert "compare_places" in grounding
    assert "Compared 2 places." in grounding
    assert "not_clear" in grounding


def test_build_tool_grounding_trims_oversized_results():
    from app.assistant.prompts import MAX_GROUNDING_RESULT_CHARS, build_tool_grounding

    grounding = build_tool_grounding(
        "analyze_places",
        "Analyzed.",
        {"blob": "x" * (MAX_GROUNDING_RESULT_CHARS * 2)},
    )
    assert len(grounding) < MAX_GROUNDING_RESULT_CHARS + 500
    assert "trimmed" in grounding


def test_build_narration_messages_shape():
    from app.assistant.prompts import NARRATION_SYSTEM_PROMPT, build_narration_messages

    history = [
        AssistantChatMessage(role="user", content="compare my places"),
        AssistantChatMessage(role="assistant", content="on it"),
        AssistantChatMessage(role="user", content="and the verdict?"),
    ]
    built = build_narration_messages(history, "GROUNDING-BLOCK")
    assert built[0] == {"role": "system", "content": NARRATION_SYSTEM_PROMPT}
    assert [m["role"] for m in built[1:-1]] == ["user", "assistant", "user"]
    assert built[-1]["role"] == "user"
    assert "GROUNDING-BLOCK" in built[-1]["content"]
    assert "ONLY" in built[-1]["content"]


def test_build_tool_grounding_serializes_dates():
    from datetime import date

    from app.assistant.prompts import build_tool_grounding

    grounding = build_tool_grounding(
        "compare_places",
        "Compared.",
        {"result": {"analysis_start_date": date(2024, 1, 1)}},
    )
    assert "2024-01-01" in grounding


def test_build_narration_messages_handles_empty_history():
    from app.assistant.prompts import build_narration_messages

    built = build_narration_messages([], "FACTS")
    assert [m["role"] for m in built] == ["system", "user"]
    assert "FACTS" in built[-1]["content"]
