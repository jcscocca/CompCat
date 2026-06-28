# Waypoint Analyst Agent Implementation Plan

> **Superseded (historical record):** This plan wired the assistant through **LocalAgent**
> for LLM routing/streaming. LocalAgent has since been **retired** — the assistant now calls
> an OpenAI-compatible endpoint directly (`MCA_LLM_BASE_URL` / `MCA_LLM_MODEL`); the client
> module is `app/assistant/llm_client.py` (not `localagent_client.py`). Mentions of LocalAgent
> and `MCA_LOCALAGENT_BASE_URL` below describe the original design. See CLAUDE.md / docs/DEPLOY.md.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Waypoint analyst agent that explains dashboard data and triggers approved analyses through Waypoint tools while using LocalAgent for local LLM routing and streaming.

**Architecture:** LocalAgent exposes a product-neutral LLM streaming gateway and a `waypoint_analyst` routing role. Waypoint owns the semantic layer, tool registry, agent loop, assistant route, and dashboard UI. The LLM can only request structured tool calls that Waypoint validates and executes through existing public-session services.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy, Server-Sent Events, pytest, React 19, Vite, TypeScript, Vitest.

---

## File Structure

### LocalAgent Repo: `/Users/jscocca/Repos/localagent`

- Modify: `/Users/jscocca/Repos/localagent/supervisor/node_models.yaml`
  - Add `waypoint_analyst` role.
- Create: `/Users/jscocca/Repos/localagent/api/routes_llm_gateway.py`
  - Product-neutral LLM streaming endpoint.
- Modify: `/Users/jscocca/Repos/localagent/api/app.py`
  - Mount gateway router under `/api`.
- Create: `/Users/jscocca/Repos/localagent/tests/test_llm_gateway.py`
  - Validate request handling, role binding, streaming events, and error events.

### Waypoint Repo: `/Users/jscocca/Repos/Crime Commute Safety Tool`

- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/__init__.py`
  - Assistant package marker.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/schemas.py`
  - Chat, semantic context, tool, and stream-event schemas.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/semantic_layer.py`
  - Builds privacy-safe context packets.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/tools.py`
  - Validated registry around existing services.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/prompts.py`
  - Planning and narration prompt builders.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/localagent_client.py`
  - LocalAgent SSE client.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/agent.py`
  - Bounded model/tool loop.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/api/routes_assistant.py`
  - Public-session assistant endpoint.
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/main.py`
  - Mount assistant router.
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/config.py`
  - Add LocalAgent URL and assistant defaults.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_semantic_layer.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_tools.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_agent.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_api.py`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/api/client.ts`
  - Add assistant chat client.
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/types.ts`
  - Add assistant request, event, and message types.
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/components/AssistantPanel.tsx`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/components/AssistantPanel.test.tsx`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/App.tsx`
  - Wire assistant panel into dashboard state.
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/styles.css`
  - Assistant panel styling.

---

## Task 1: LocalAgent Product-Neutral LLM Gateway

**Files:**
- Create: `/Users/jscocca/Repos/localagent/api/routes_llm_gateway.py`
- Modify: `/Users/jscocca/Repos/localagent/api/app.py`
- Modify: `/Users/jscocca/Repos/localagent/supervisor/node_models.yaml`
- Test: `/Users/jscocca/Repos/localagent/tests/test_llm_gateway.py`

- [ ] **Step 1: Add failing tests for gateway streaming**

Create `/Users/jscocca/Repos/localagent/tests/test_llm_gateway.py` with tests that monkeypatch gateway LLM creation:

```python
import json

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


class FakeChunk:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeLlm:
    async def astream(self, messages, stop=None):
        yield FakeChunk("hello")
        yield FakeChunk(" world")


def test_llm_gateway_streams_meta_token_done(monkeypatch):
    from api import routes_llm_gateway

    monkeypatch.setattr(routes_llm_gateway, "_gateway_llm", lambda *args, **kwargs: FakeLlm())
    app = create_app()
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/llm/stream",
        json={
            "role": "waypoint_analyst",
            "messages": [
                {"role": "system", "content": "You are concise."},
                {"role": "user", "content": "Say hi."},
            ],
        },
    ) as response:
        body = response.read().decode()

    assert response.status_code == 200
    assert "event: meta" in body
    assert '"role": "waypoint_analyst"' in body
    assert "event: token" in body
    assert '"delta": "hello"' in body
    assert '"delta": " world"' in body
    assert "event: done" in body


def test_llm_gateway_rejects_empty_messages():
    app = create_app()
    client = TestClient(app)

    response = client.post(
        "/api/llm/stream",
        json={"role": "waypoint_analyst", "messages": []},
    )

    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/jscocca/Repos/localagent
pytest tests/test_llm_gateway.py -q
```

Expected: fail because `api.routes_llm_gateway` does not exist.

- [ ] **Step 3: Implement gateway route**

Create `/Users/jscocca/Repos/localagent/api/routes_llm_gateway.py`:

```python
from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api.chat_display_profiles import llm_model_name, resolve_chat_display_profile
from workflows.nodes import QA_DEEP
from workflows.runtime import _llm

router = APIRouter()


class GatewayMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = Field(min_length=1)
    tool_call_id: str | None = None


class GatewayRequest(BaseModel):
    role: str = Field(min_length=1, max_length=80)
    messages: list[GatewayMessage] = Field(min_length=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=32768)
    stop: list[str] = Field(default_factory=list)
    stream: bool = True


def _gateway_messages(messages: list[GatewayMessage]) -> list[BaseMessage]:
    converted: list[BaseMessage] = []
    for message in messages:
        if message.role == "system":
            converted.append(SystemMessage(content=message.content))
        elif message.role == "user":
            converted.append(HumanMessage(content=message.content))
        elif message.role == "assistant":
            converted.append(AIMessage(content=message.content))
        else:
            converted.append(
                ToolMessage(
                    content=message.content,
                    tool_call_id=message.tool_call_id or "waypoint-tool",
                )
            )
    return converted


def _chunk_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return ""


def _gateway_llm(role: str, **overrides: Any) -> Any:
    return _llm(role, QA_DEEP, workflow="llm_gateway", streaming=True, **overrides)


@router.post("/llm/stream")
async def llm_stream(payload: GatewayRequest, request: Request) -> EventSourceResponse:
    messages = _gateway_messages(payload.messages)
    overrides: dict[str, Any] = {}
    if payload.temperature is not None:
        overrides["temperature"] = payload.temperature
    if payload.max_tokens is not None:
        overrides["max_tokens"] = payload.max_tokens

    async def event_gen():
        try:
            llm = _gateway_llm(payload.role, **overrides)
            model_name = llm_model_name(llm)
            display_profile = resolve_chat_display_profile(model_name)
            yield {
                "event": "meta",
                "data": json.dumps(
                    {
                        "role": payload.role,
                        "model": model_name,
                        "profile": display_profile.profile,
                        "thinking_tags": display_profile.thinking_tags,
                        "strip_tokens": display_profile.strip_tokens,
                    }
                ),
            }
            stop = payload.stop or None
            async for chunk in llm.astream(messages, stop=stop):
                if await request.is_disconnected():
                    return
                text = _chunk_text(getattr(chunk, "content", ""))
                if text:
                    yield {"event": "token", "data": json.dumps({"delta": text})}
            yield {"event": "done", "data": "{}"}
        except asyncio.CancelledError:
            return
        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_gen())
```

- [ ] **Step 4: Mount gateway router**

Modify `/Users/jscocca/Repos/localagent/api/app.py` near other route imports:

```python
from api.routes_llm_gateway import router as llm_gateway_router
```

and include it:

```python
app.include_router(llm_gateway_router, prefix="/api")
```

- [ ] **Step 5: Add `waypoint_analyst` role**

Modify `/Users/jscocca/Repos/localagent/supervisor/node_models.yaml` under `roles:`:

```yaml
  waypoint_analyst:
    gb_band: { min: 4, max: 16 }
    context_tokens: 32768
    context_verified: false
    context_reserve_tokens: 2048
    temperature: 0.2
    max_tokens: 2048
```

- [ ] **Step 6: Run LocalAgent gateway tests**

Run:

```bash
cd /Users/jscocca/Repos/localagent
pytest tests/test_llm_gateway.py -q
```

Expected: pass.

---

## Task 2: Waypoint Assistant Schemas And Semantic Layer

**Files:**
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/__init__.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/schemas.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/semantic_layer.py`
- Test: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_semantic_layer.py`

- [ ] **Step 1: Add failing semantic layer tests**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_semantic_layer.py`:

```python
from datetime import date

from app.assistant.schemas import AssistantDashboardState
from app.assistant.semantic_layer import build_semantic_context
from app.config import get_settings
from app.models import PlaceCluster, PlaceCrimeSummary


def test_semantic_context_includes_selected_places_and_caveats(db_session):
    user_hash = "user-1"
    place = PlaceCluster(
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
        inferred_place_type="unknown",
    )
    summary = PlaceCrimeSummary(
        id="summary-1",
        user_id_hash=user_hash,
        place_cluster_id="place-1",
        radius_m=500,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 31),
        incident_count=4,
        nearest_incident_m=120,
    )
    db_session.add_all([place, summary])
    db_session.commit()

    packet = build_semantic_context(
        db_session,
        user_hash,
        AssistantDashboardState(
            selected_place_ids=["place-1"],
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 1, 31),
            radii_m=[500],
        ),
        get_settings(),
    )

    assert packet.dashboard_totals["place_count"] == 1
    assert packet.selected_places[0]["display_label"] == "Library stop"
    assert packet.crime_summaries[0]["incident_count"] == 4
    assert any("reported incident" in caveat.lower() for caveat in packet.policy_caveats)
    assert "user-1" not in packet.model_dump_json()


def test_semantic_context_reports_missing_selection(db_session):
    packet = build_semantic_context(
        db_session,
        "user-1",
        AssistantDashboardState(),
        get_settings(),
    )

    assert "No saved places are available." in packet.missing_context
    assert "No places are selected." in packet.missing_context
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_semantic_layer.py -q
```

Expected: fail because assistant modules do not exist.

- [ ] **Step 3: Add schemas**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/__init__.py` as an empty file.

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/schemas.py`:

```python
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class AssistantChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class AssistantDashboardState(BaseModel):
    selected_place_ids: list[str] = Field(default_factory=list)
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[int] = Field(default_factory=list)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class SemanticContextPacket(BaseModel):
    dashboard_totals: dict[str, Any]
    selected_places: list[dict[str, Any]]
    crime_summaries: list[dict[str, Any]]
    active_filters: dict[str, Any]
    available_tools: list[dict[str, Any]]
    policy_caveats: list[str]
    missing_context: list[str]


class AssistantChatRequest(BaseModel):
    messages: list[AssistantChatMessage] = Field(min_length=1)
    dashboard_state: AssistantDashboardState = Field(default_factory=AssistantDashboardState)


class AssistantStreamEvent(BaseModel):
    event: Literal["meta", "tool", "token", "done", "error"]
    data: dict[str, Any]
```

- [ ] **Step 4: Implement semantic layer**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/semantic_layer.py`:

```python
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assistant.schemas import AssistantDashboardState, SemanticContextPacket
from app.config import Settings
from app.models import PlaceCluster, PlaceCrimeSummary
from app.services.dashboard_service import dashboard_summary


POLICY_CAVEATS = [
    "Waypoint describes reported incident context, not personal safety.",
    "Do not label places as safe or unsafe.",
    "Expected weekly visits are routine metadata, not a risk denominator.",
    "Reported incident data can be incomplete, delayed, or filtered by the current analysis settings.",
]


AVAILABLE_TOOLS = [
    {"name": "get_dashboard_summary", "description": "Read current dashboard totals and saved places."},
    {"name": "run_place_analysis", "description": "Refresh reported incident summaries for selected places."},
    {"name": "compare_places", "description": "Compare reported incident context for selected places."},
    {"name": "get_incident_details", "description": "Fetch capped reported incident detail rows near selected places."},
    {"name": "suggest_followups", "description": "Suggest deterministic follow-up questions."},
]


def build_semantic_context(
    session: Session,
    user_id_hash: str,
    state: AssistantDashboardState,
    settings: Settings,
) -> SemanticContextPacket:
    summary = dashboard_summary(session, user_id_hash, settings)
    selected_ids = list(dict.fromkeys(state.selected_place_ids))
    selected_places = _selected_places(session, user_id_hash, selected_ids)
    crime_summaries = _crime_summaries(session, user_id_hash, selected_ids)
    missing_context = _missing_context(summary, selected_ids, selected_places, state)
    return SemanticContextPacket(
        dashboard_totals=dict(summary["totals"], available_radii_m=settings.crime_radii_m),
        selected_places=[_place_payload(place) for place in selected_places],
        crime_summaries=[_summary_payload(row) for row in crime_summaries],
        active_filters={
            "selected_place_ids": selected_ids,
            "analysis_start_date": state.analysis_start_date.isoformat() if state.analysis_start_date else None,
            "analysis_end_date": state.analysis_end_date.isoformat() if state.analysis_end_date else None,
            "radii_m": state.radii_m,
            "offense_category": state.offense_category,
            "offense_subcategory": state.offense_subcategory,
            "nibrs_group": state.nibrs_group,
        },
        available_tools=AVAILABLE_TOOLS,
        policy_caveats=POLICY_CAVEATS,
        missing_context=missing_context,
    )


def _selected_places(session: Session, user_id_hash: str, selected_ids: list[str]) -> list[PlaceCluster]:
    if not selected_ids:
        return []
    return list(
        session.scalars(
            select(PlaceCluster)
            .where(PlaceCluster.user_id_hash == user_id_hash)
            .where(PlaceCluster.id.in_(selected_ids))
            .order_by(PlaceCluster.visit_count.desc(), PlaceCluster.display_label.asc())
        )
    )


def _crime_summaries(session: Session, user_id_hash: str, selected_ids: list[str]) -> list[PlaceCrimeSummary]:
    statement = select(PlaceCrimeSummary).where(PlaceCrimeSummary.user_id_hash == user_id_hash)
    if selected_ids:
        statement = statement.where(PlaceCrimeSummary.place_cluster_id.in_(selected_ids))
    return list(session.scalars(statement.order_by(PlaceCrimeSummary.radius_m.asc())))


def _place_payload(place: PlaceCluster) -> dict[str, Any]:
    return {
        "id": place.id,
        "display_label": place.display_label,
        "latitude": place.display_latitude,
        "longitude": place.display_longitude,
        "visit_count": place.visit_count,
        "total_dwell_minutes": place.total_dwell_minutes,
        "median_dwell_minutes": place.median_dwell_minutes,
        "inferred_place_type": place.inferred_place_type,
        "sensitivity_class": place.sensitivity_class,
    }


def _summary_payload(summary: PlaceCrimeSummary) -> dict[str, Any]:
    return {
        "place_cluster_id": summary.place_cluster_id,
        "radius_m": summary.radius_m,
        "analysis_start_date": summary.analysis_start_date.isoformat(),
        "analysis_end_date": summary.analysis_end_date.isoformat(),
        "offense_category": summary.offense_category,
        "offense_subcategory": summary.offense_subcategory,
        "nibrs_group": summary.nibrs_group,
        "incident_count": summary.incident_count,
        "nearest_incident_m": float(summary.nearest_incident_m) if summary.nearest_incident_m is not None else None,
    }


def _missing_context(
    summary: dict[str, Any],
    selected_ids: list[str],
    selected_places: list[PlaceCluster],
    state: AssistantDashboardState,
) -> list[str]:
    missing: list[str] = []
    if summary["totals"]["place_count"] == 0:
        missing.append("No saved places are available.")
    if not selected_ids:
        missing.append("No places are selected.")
    elif len(selected_places) != len(selected_ids):
        missing.append("One or more selected places are unavailable in this public session.")
    if state.analysis_start_date is None or state.analysis_end_date is None:
        missing.append("No complete analysis date range is selected.")
    if not state.radii_m:
        missing.append("No analysis radius is selected.")
    return missing
```

- [ ] **Step 5: Run semantic layer tests**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_semantic_layer.py -q
```

Expected: pass.

---

## Task 3: Waypoint Tool Registry

**Files:**
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/tools.py`
- Test: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_tools.py`

- [ ] **Step 1: Add failing tool tests**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_tools.py` with tests for unknown-tool rejection, limit capping, and delegation:

```python
from datetime import date

import pytest

from app.assistant.tools import AssistantToolError, execute_tool


def test_unknown_tool_is_rejected(db_session):
    with pytest.raises(AssistantToolError):
        execute_tool(db_session, "user-1", "raw_sql", {})


def test_suggest_followups_returns_deterministic_questions(db_session):
    result = execute_tool(db_session, "user-1", "suggest_followups", {})

    assert result["tool_name"] == "suggest_followups"
    assert result["result"]["suggestions"]
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_tools.py -q
```

Expected: fail because `app.assistant.tools` does not exist.

- [ ] **Step 3: Implement tool registry**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/tools.py` with Pydantic argument models and a single `execute_tool(...)` function that dispatches to existing services. Use this public interface:

```python
class AssistantToolError(ValueError):
    pass


def execute_tool(
    session: Session,
    user_id_hash: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    ...
```

The returned envelope must be:

```python
{
    "tool_name": tool_name,
    "arguments": validated_arguments,
    "result": service_result,
}
```

For `get_incident_details`, force `limit = min(limit, 100)`.

- [ ] **Step 4: Run tool tests**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_tools.py -q
```

Expected: pass.

---

## Task 4: Waypoint LocalAgent Client And Agent Loop

**Files:**
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/localagent_client.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/prompts.py`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/assistant/agent.py`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/config.py`
- Test: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_agent.py`

- [ ] **Step 1: Add failing agent-loop tests**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_agent.py`:

```python
from datetime import date

import pytest

from app.assistant.agent import run_assistant_turn
from app.assistant.schemas import AssistantChatMessage, AssistantDashboardState


class FakeClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls = []

    async def complete(self, messages, *, role, temperature=None, max_tokens=None):
        self.calls.append(messages)
        return self.responses.pop(0)


@pytest.mark.anyio
async def test_agent_returns_final_without_tool(db_session):
    client = FakeClient(['{"type":"final","message":"There are no saved places yet."}'])

    events = [
        event
        async for event in run_assistant_turn(
            db_session,
            "user-1",
            [AssistantChatMessage(role="user", content="What do you see?")],
            AssistantDashboardState(),
            client,
        )
    ]

    assert events[-1].event == "done"
    assert any(event.event == "token" for event in events)


@pytest.mark.anyio
async def test_agent_rejects_safe_unsafe_question(db_session):
    client = FakeClient(['{"type":"final","message":"I can discuss reported incident context, not label places safe or unsafe."}'])

    events = [
        event
        async for event in run_assistant_turn(
            db_session,
            "user-1",
            [AssistantChatMessage(role="user", content="Which place is safest?")],
            AssistantDashboardState(),
            client,
        )
    ]

    text = "".join(event.data.get("delta", "") for event in events if event.event == "token")
    assert "reported incident context" in text
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_agent.py -q
```

Expected: fail because agent modules do not exist.

- [ ] **Step 3: Add config fields**

Modify `/Users/jscocca/Repos/Crime Commute Safety Tool/app/config.py`:

```python
    localagent_base_url: str = "http://127.0.0.1:8000"
    assistant_role: str = "waypoint_analyst"
    assistant_max_tool_calls: int = 2
```

- [ ] **Step 4: Implement prompts and client**

`prompts.py` exports `build_planning_messages(...)` and `build_narration_messages(...)`.

`localagent_client.py` exports `LocalAgentClient.complete(...)`, which posts to
`{base_url}/api/llm/stream`, consumes SSE events, joins token deltas, and raises
`LocalAgentUnavailable` on request failure or gateway error event.

- [ ] **Step 5: Implement agent loop**

`agent.py` exports:

```python
async def run_assistant_turn(
    session: Session,
    user_id_hash: str,
    messages: list[AssistantChatMessage],
    dashboard_state: AssistantDashboardState,
    llm_client: AssistantLlmClient,
) -> AsyncIterator[AssistantStreamEvent]:
    ...
```

The loop builds semantic context, calls the model, parses JSON, optionally
executes one or two tools through `execute_tool`, and yields `token`, `tool`,
`done`, or `error` events.

- [ ] **Step 6: Run agent tests**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_agent.py -q
```

Expected: pass.

---

## Task 5: Waypoint Assistant API

**Files:**
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/api/routes_assistant.py`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/app/main.py`
- Test: `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_api.py`

- [ ] **Step 1: Add failing API tests**

Create `/Users/jscocca/Repos/Crime Commute Safety Tool/tests/test_assistant_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_assistant_chat_requires_public_session():
    client = TestClient(create_app("sqlite+pysqlite:///:memory:"))

    response = client.post(
        "/assistant/chat",
        json={"messages": [{"role": "user", "content": "Summarize this."}], "dashboard_state": {}},
    )

    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_api.py -q
```

Expected: fail because route does not exist.

- [ ] **Step 3: Implement assistant route**

Create route using `required_public_user_hash`, `get_session`, and
`EventSourceResponse`. Stream `AssistantStreamEvent` objects from
`run_assistant_turn(...)`.

- [ ] **Step 4: Mount router**

Modify `/Users/jscocca/Repos/Crime Commute Safety Tool/app/main.py`:

```python
from app.api.routes_assistant import router as assistant_router
...
app.include_router(assistant_router)
```

- [ ] **Step 5: Run API tests**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_api.py -q
```

Expected: pass.

---

## Task 6: Waypoint Frontend Assistant Panel

**Files:**
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/api/client.ts`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/types.ts`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/components/AssistantPanel.tsx`
- Create: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/components/AssistantPanel.test.tsx`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/App.tsx`
- Modify: `/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/src/styles.css`

- [ ] **Step 1: Add frontend test**

Create a test that renders `AssistantPanel`, mocks `fetch`, sends a message, and
asserts the current dashboard state is posted to `/assistant/chat`.

- [ ] **Step 2: Run frontend test to verify failure**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool/frontend'
npm test -- AssistantPanel.test.tsx
```

Expected: fail because `AssistantPanel` does not exist.

- [ ] **Step 3: Add assistant types and client**

Add TypeScript types for assistant messages, dashboard state, and stream events.
Add a `streamAssistantChat(...)` helper that parses SSE event blocks from
`fetch("/assistant/chat", { credentials: "include" })`.

- [ ] **Step 4: Implement assistant panel**

The panel contains a scrollable message log, a compact input row, a send button,
and a slim tool-activity list. It receives dashboard state from `App.tsx`.

- [ ] **Step 5: Wire panel into `App.tsx`**

Pass selected place ids, analysis date range, radii, and filters from existing
dashboard state into `AssistantPanel`.

- [ ] **Step 6: Run frontend tests**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool/frontend'
npm test -- AssistantPanel.test.tsx
npm run lint
```

Expected: pass.

---

## Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run LocalAgent verification**

Run:

```bash
cd /Users/jscocca/Repos/localagent
pytest tests/test_llm_gateway.py -q
ruff check api supervisor workflows tests
```

Expected: pass.

- [ ] **Step 2: Run Waypoint backend verification**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool'
pytest tests/test_assistant_semantic_layer.py tests/test_assistant_tools.py tests/test_assistant_agent.py tests/test_assistant_api.py -q
ruff check .
```

Expected: pass.

- [ ] **Step 3: Run Waypoint frontend verification**

Run:

```bash
cd '/Users/jscocca/Repos/Crime Commute Safety Tool/frontend'
npm test
npm run lint
npm run build
```

Expected: pass.

- [ ] **Step 4: Inspect git status in both repos**

Run:

```bash
git -C /Users/jscocca/Repos/localagent status --short --branch
git -C '/Users/jscocca/Repos/Crime Commute Safety Tool' status --short --branch
```

Expected: only intentional files are modified on `codex/waypoint-analyst-agent`.

---

## Self-Review Notes

Spec coverage:

- LocalAgent LLM gateway is covered by Task 1.
- Waypoint semantic layer is covered by Task 2.
- Waypoint tool execution is covered by Task 3.
- Agent loop and LocalAgent client are covered by Task 4.
- Public assistant API is covered by Task 5.
- Frontend assistant surface is covered by Task 6.
- Verification is covered by Task 7.

Placeholder scan:

- This plan intentionally avoids deferred implementation placeholders. Where a
  task delegates detailed code shape to implementation, it still names the exact
  file, public interface, tests, command, and expected result.

Type consistency:

- `AssistantDashboardState`, `AssistantChatMessage`,
  `SemanticContextPacket`, and `AssistantStreamEvent` are introduced before use.
- Tool names match the design spec.
- The LocalAgent role name is consistently `waypoint_analyst`.

