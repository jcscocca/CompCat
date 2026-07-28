from __future__ import annotations

import asyncio

import pytest

from app.assistant.agent import run_assistant_turn
from app.assistant.schemas import AssistantChatMessage, AssistantDashboardState
from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster
from app.ratelimit import get_rate_limiter

# The one new user-facing string in this slice. Pinned as a literal (not imported) so a copy
# change has to be deliberate.
_BUDGET_MESSAGE = (
    "Tabby's used up today's analysis budget. Free-text chat returns tomorrow — "
    "chips, filters, and analysis still work."
)


class BudgetFakeClient:
    """Records what the turn actually sent upstream and, like the real clients, charges the
    daily token counter for each completed call."""

    def __init__(self, responses: list[str], *, tokens_per_call: int = 0) -> None:
        self.responses = responses
        self.tokens_per_call = tokens_per_call
        self.complete_calls = 0
        self.stream_calls = 0

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.complete_calls += 1
        if self.tokens_per_call:
            get_rate_limiter().add_tokens(self.tokens_per_call)
        return self.responses.pop(0)

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ):
        self.stream_calls += 1
        yield "narrated"


def _session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="place-1",
            user_id_hash="user-1",
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
    session.commit()
    return session, "user-1"


def _run(session, user_hash, client):
    async def go():
        return [
            event
            async for event in run_assistant_turn(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="What do you see?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        ]

    return asyncio.run(go())


def test_turn_refuses_before_the_planning_call_when_the_budget_is_spent(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "1000")
    session, user_hash = _session(tmp_path)
    get_rate_limiter().add_tokens(1000)
    client = BudgetFakeClient(['{"type":"final","message":"never reached"}'])
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "error"]
    assert events[1].data["message"] == _BUDGET_MESSAGE
    assert events[1].data["code"] == "budget_exhausted"
    assert client.complete_calls == 0  # no upstream call was made


def test_turn_refuses_before_narration_when_planning_spends_the_budget(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_NARRATION_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "1000")
    session, user_hash = _session(tmp_path)
    client = BudgetFakeClient(
        ['{"type":"final","message":"One saved stop is selected."}'], tokens_per_call=1200
    )
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "status", "error"]
    assert events[2].data["message"] == _BUDGET_MESSAGE
    assert client.complete_calls == 1
    assert client.stream_calls == 0  # narration never reached the model


def test_turn_is_unaffected_when_no_budget_is_configured(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_NARRATION_ENABLED", "false")
    monkeypatch.delenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", raising=False)
    session, user_hash = _session(tmp_path)
    get_rate_limiter().add_tokens(10_000_000)
    client = BudgetFakeClient(['{"type":"final","message":"One saved stop is selected."}'])
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert client.complete_calls == 1


def test_budget_is_not_enforced_when_rate_limiting_is_off(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("MCA_ASSISTANT_NARRATION_ENABLED", "false")
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "1000")
    session, user_hash = _session(tmp_path)
    get_rate_limiter().add_tokens(5_000)
    client = BudgetFakeClient(['{"type":"final","message":"One saved stop is selected."}'])
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]


def test_budget_message_stays_out_of_place_and_safety_vocabulary() -> None:
    lowered = _BUDGET_MESSAGE.lower()
    for banned in (
        "safe",
        "unsafe",
        "safety",
        "danger",
        "risk",
        "place",
        "address",
        "neighborhood",
        "incident",
    ):
        assert banned not in lowered
