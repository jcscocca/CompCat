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
    }

