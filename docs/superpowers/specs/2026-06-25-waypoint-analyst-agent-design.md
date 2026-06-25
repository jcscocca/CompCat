# Waypoint Analyst Agent Design

## Objective

Build a Tableau-Agent-like analyst for Waypoint that can explain the current
dashboard data and trigger additional analyses through typed Waypoint tools,
while LocalAgent supplies local LLM routing, model loading, and token streaming.

## Current Context

Waypoint is a FastAPI and React/Vite application for privacy-first reported
incident analysis around selected places and commute routes. Its public posture
is intentionally narrow:

- It describes reported incident context, not personal safety.
- It does not label places as safe or unsafe.
- It treats expected weekly visits as routine metadata, not a risk denominator.
- It already exposes public-session-gated endpoints for dashboard summary,
  selected-place analysis, incident details, and selected-place comparison.

LocalAgent is a separate FastAPI and React/Vite application with a mature local
LLM control plane:

- Supervisor routing binds roles to concrete node/model choices.
- Nodes may be backed by llama-swap, Ollama, or LM Studio.
- Model load, unload, telemetry, and routing policies already exist.
- The current chat endpoint is repo-context-specific, so a product-neutral LLM
  gateway should be added instead of reusing repo chat directly.

## Approved Architecture

Waypoint owns the semantic layer, product policy, and tool execution. LocalAgent
owns local model routing and streaming. The LLM receives compact semantic
context and tool results; it never receives raw database authority.

The runtime path is:

1. The Waypoint frontend sends chat history and current dashboard state to
   `POST /assistant/chat`.
2. Waypoint builds a `SemanticContextPacket` from the public session, selected
   places, dashboard summaries, analysis filters, and policy caveats.
3. Waypoint sends the model a tool-planning prompt through a LocalAgent LLM
   gateway.
4. The model returns either a final answer or a structured tool request.
5. Waypoint validates the tool request against a fixed tool registry and the
   current public session.
6. Waypoint executes the tool using existing services.
7. Waypoint sends tool results back through the LocalAgent gateway for final
   narration.
8. The frontend streams assistant text and tool activity events.

## Integration Boundary

### LocalAgent

LocalAgent adds a generic streaming endpoint:

```text
POST /api/llm/stream
```

The endpoint is intentionally lower level than `/api/chat`. It does not compile
repository context and does not use LocalAgent's chat system prompt. It accepts
prebuilt messages from a trusted local product caller and streams Server-Sent
Events.

Request fields:

- `role`: model role name. Waypoint uses `waypoint_analyst`.
- `messages`: ordered messages with `system`, `user`, `assistant`, or `tool`
  roles.
- `temperature`: optional float override.
- `max_tokens`: optional integer override.
- `stop`: optional list of stop strings.
- `stream`: boolean, default true.

Stream events:

- `meta`: selected model, node, display profile, and routing role.
- `token`: text delta.
- `done`: terminal success event.
- `error`: terminal error event with a user-safe message.

LocalAgent adds a supervisor role named `waypoint_analyst` with conservative
temperature and enough context capacity for compact dashboard context plus tool
results.

### Waypoint

Waypoint adds an assistant package:

```text
app/assistant/__init__.py
app/assistant/agent.py
app/assistant/localagent_client.py
app/assistant/prompts.py
app/assistant/schemas.py
app/assistant/semantic_layer.py
app/assistant/tools.py
```

Waypoint adds a route module:

```text
app/api/routes_assistant.py
```

and mounts it in `app/main.py`.

## Semantic Layer

The semantic layer returns a compact, LLM-readable packet that is safe to
include in prompts.

`SemanticContextPacket` contains:

- `dashboard_totals`: place count, expected weekly visits, reported incident
  count from persisted summaries, and available radii.
- `selected_places`: id, display label, generalized display latitude/longitude,
  expected weekly visit count, dwell metadata, sensitivity class, and inferred
  place type for currently selected place ids.
- `crime_summaries`: persisted place summary rows for selected places, grouped by
  radius and date range.
- `active_filters`: selected place ids, analysis start/end dates, radii,
  offense category, offense subcategory, and NIBRS group.
- `available_tools`: tool names and argument schemas.
- `policy_caveats`: fixed caveats that responses must respect.
- `missing_context`: plain-language notes when the dashboard lacks places,
  summaries, selected place ids, date range, or incident data.

The packet excludes:

- Raw source GPS observations.
- Raw SQL or table names as an action surface.
- Unbounded incident rows.
- Sensitive exact coordinates when display coordinates exist.
- Internal user hash values.

## Tool Registry

The first Waypoint tool set is deliberately small and backed by existing
services.

### `get_dashboard_summary`

Returns the public dashboard summary for the current session.

Arguments:

- No required arguments.

Execution:

- Calls `dashboard_summary(session, user_id_hash, get_settings())`.

### `run_place_analysis`

Runs selected-place analysis and refreshes persisted place summaries.

Arguments:

- `place_ids`: non-empty list of existing public-session place ids.
- `analysis_start_date`: ISO date.
- `analysis_end_date`: ISO date.
- `radii_m`: non-empty unique list of positive radii, max 5000.
- `offense_category`: optional string.
- `offense_subcategory`: optional string.
- `nibrs_group`: optional string.

Execution:

- Calls `analyze_selected_places(...)`.
- Returns summary count and a refreshed semantic summary.

### `compare_places`

Runs selected-place statistical comparison.

Arguments:

- `place_ids`: at least two existing public-session place ids.
- `analysis_start_date`: ISO date.
- `analysis_end_date`: ISO date.
- `radius_m`: positive radius, max 5000.
- `offense_category`: optional string.
- `offense_subcategory`: optional string.
- `nibrs_group`: optional string.

Execution:

- Calls `compare_selected_places(...)`.
- Returns the persisted comparison payload.

### `get_incident_details`

Returns capped incident rows near selected places.

Arguments:

- `place_ids`: non-empty list of existing public-session place ids.
- `analysis_start_date`: ISO date.
- `analysis_end_date`: ISO date.
- `radii_m`: non-empty list; only the first radius is used by the existing
  service.
- `limit`: integer between 1 and 100 for the agent path.
- `offense_category`: optional string.
- `offense_subcategory`: optional string.
- `nibrs_group`: optional string.

Execution:

- Calls `incident_details_for_places(...)`.
- Caps `limit` to 100 even though the public API supports larger requests.

### `suggest_followups`

Returns deterministic follow-up question suggestions derived from the semantic
packet and available tools.

Arguments:

- No required arguments.

Execution:

- Does not call the LLM.
- Suggests questions such as comparing selected places, checking another radius,
  inspecting incident details, or narrowing by date range when the current
  context supports those actions.

## Agent Loop

The v1 agent loop is bounded and deterministic around tool authority.

Maximums:

- At most three model calls per user request.
- At most two tool executions per user request.
- At most one state-changing analysis tool per user request.

Allowed model outputs:

```json
{"type":"final","message":"..."}
```

or:

```json
{"type":"tool_call","tool_name":"run_place_analysis","arguments":{...}}
```

Waypoint parses model output as JSON. If parsing fails, Waypoint asks the model
one repair question. If repair fails, the route returns a user-safe error event
and does not execute a tool.

State-changing tools:

- `run_place_analysis`
- `compare_places`

These may run when the user's wording requests or implies an analysis action,
such as "compare these places", "run this for March", or "show incidents at
500m". The v1 agent does not require an extra confirmation because the approved
scope limits state changes to existing analysis/comparison records.

## Prompt Policy

The system prompt tells the model:

- You are Waypoint's reported-incident analyst.
- Use only the semantic context and tool results.
- Do not call places safe or unsafe.
- Do not produce personal safety scores.
- Do not treat expected visits as a risk denominator.
- Say when data is missing, stale, filtered, or insufficient.
- Ask for missing place selection, date range, or radius when required.
- Prefer concise explanations with concrete counts, dates, radii, and caveats.
- Return only the required JSON object during planning calls.

## Frontend Experience

The assistant appears as a compact dashboard drawer or panel. It should feel like
an analyst surface inside the existing tool, not a marketing chatbot.

Frontend responsibilities:

- Maintain local chat history.
- Include current dashboard state in each request:
  - selected place ids
  - analysis start date
  - analysis end date
  - selected radii
  - offense filters
- Render assistant text.
- Render tool activity events such as "Ran analysis for 2 places at 500m".
- Show errors without clearing chat history.
- Keep existing dashboard workflows usable without the assistant.

## Error Handling

LocalAgent unavailable:

- Waypoint returns an assistant error event explaining that the local model
  service is unavailable.
- Tool execution does not occur after an unavailable-model planning failure.

Invalid tool arguments:

- Waypoint rejects the tool call before service execution.
- The agent asks for the missing or invalid input when possible.

Missing dashboard context:

- If no public session exists, `POST /assistant/chat` returns 401 through the
  same public-session dependency as other public dashboard routes.
- If no places exist, the assistant explains that places must be added before
  analysis can run.
- If selected-place tools are requested without selected place ids, the assistant
  asks the user to select places.

Service errors:

- Existing `ValueError` messages are converted into user-safe assistant errors.
- Unexpected exceptions produce a generic error event and are logged by FastAPI.

## Security And Privacy

The model cannot:

- Execute SQL.
- Choose arbitrary Python functions.
- Fetch URLs.
- Access files.
- See raw upload artifacts.
- See raw source GPS observations.
- Request more than the capped incident detail limit.

All assistant data access uses the current public session user hash. The agent
route uses `required_public_user_hash`, not the internal demo fallback.

## Testing Requirements

Waypoint backend tests:

- Semantic packet includes dashboard totals, selected places, summaries, filters,
  policy caveats, and missing-context notes.
- Semantic packet excludes user hash and raw observation fields.
- Each tool validates arguments and delegates to the existing service function.
- Tool registry rejects unknown tools and invalid arguments.
- Agent loop executes a model-requested `run_place_analysis`.
- Agent loop executes a model-requested `compare_places`.
- Agent loop executes `get_incident_details` with limit capped to 100.
- Agent loop returns a final answer without a tool when model output is final.
- Agent loop refuses or redirects safe/unsafe scoring language.
- LocalAgent outage returns a user-safe assistant error.
- `POST /assistant/chat` requires a public session.

LocalAgent tests:

- Generic LLM gateway validates message input.
- Generic LLM gateway binds the requested role.
- Generic LLM gateway streams `meta`, `token`, and `done`.
- Generic LLM gateway streams `error` when binding or generation fails.

Frontend tests:

- Assistant panel sends chat history and current dashboard state.
- Assistant panel displays streamed tool activity.
- Assistant panel displays streamed assistant text.
- Assistant panel displays errors while preserving previous messages.

Verification commands:

```bash
# LocalAgent
pytest tests/test_llm_gateway.py
ruff check api supervisor workflows tests

# Waypoint backend
pytest tests/test_assistant_semantic_layer.py tests/test_assistant_tools.py tests/test_assistant_agent.py tests/test_assistant_api.py
ruff check .

# Waypoint frontend
cd frontend && npm test && npm run lint && npm run build
```

## Delivery Slices

1. LocalAgent LLM gateway with tests.
2. Waypoint semantic layer and tool registry with tests.
3. Waypoint agent loop and assistant API with tests.
4. Frontend assistant panel with tests.
5. End-to-end smoke test with LocalAgent running or a fake LocalAgent client.

## Acceptance Criteria

The feature is complete when:

- A public Waypoint session can ask an assistant question about the current
  dashboard context.
- The assistant can explain persisted dashboard summaries without triggering a
  tool.
- The assistant can trigger selected-place analysis through existing services.
- The assistant can trigger selected-place comparison through existing services.
- The assistant can fetch capped incident details through existing services.
- All assistant responses obey reported-incident wording and avoid safe/unsafe
  labels.
- Waypoint calls LocalAgent for model output instead of calling local model
  providers directly.
- Tests cover gateway, semantic layer, tools, agent loop, API, and frontend
  behavior.
- Relevant backend and frontend verification commands pass.

## Explicit Non-Goals

- Production authentication beyond the current public session model.
- New statistical methods.
- Live Socrata ingestion by the assistant.
- Raw SQL generation.
- Arbitrary chart generation.
- Autonomous multi-agent research workflows.
- Persistent assistant conversation storage.
- A production audit log UI.

