# Agent-Driven Pane Analysis (PoC) — Design

> Status: design approved via brainstorming 2026-06-28. This is the proof-of-concept
> slice of a larger goal: making the chat assistant and the dashboard right pane a single
> unified analyst interface. Scope here is deliberately narrow (Places + Analyze + Compare);
> Routes, Export, and autonomous place selection are explicit fast-follows / goal-state.

## Objective

Let the chat assistant **drive the right-pane analysis**. When a user names places in chat
and asks to analyze or compare them, the assistant resolves the places (matching saved ones,
geocoding and saving new ones), runs the analysis, and the right pane fills in and switches to
the relevant tab — automatically, while the assistant narrates what it did. The assistant
becomes a single orchestrating agent with a **toolbox of per-tab workflow tools**, not a
one-trick compare bot.

## Current Context

The assistant already exists (`app/assistant/`, `POST /assistant/chat`) as a bounded agent
loop: plan → tool → follow-up → final, streaming SSE `meta`/`tool`/`token`/`done`/`error`
events. Its tools (`run_place_analysis`, `compare_places`, `get_neighborhood_analysis`,
`get_incident_details`, `get_dashboard_summary`, `suggest_followups`) call the **same services
the dashboard uses** and operate on `place_ids` backfilled from the request's
`dashboard_state` (`app/assistant/agent.py:_tool_arguments`).

Two gaps block the objective, both confirmed by code review:

1. **No place resolution from chat.** Every tool operates only on already-selected place ids.
   There is no search/geocode/create tool, so "compare Pike Place and Capitol Hill" fails
   unless both are already saved and selected.
2. **Tool results never reach the pane.** `frontend/.../AssistantPanel.tsx` (lines 40–43)
   reads only `tool_name` from each `tool` SSE event and **discards** `arguments` and
   `result`. The right pane is driven by separate `useState` in `MapWorkspace.tsx`, populated
   by clicks and the "Run analysis" button. The chat *reads* dashboard state but never
   *writes* it. The two halves are one-way and disconnected.

### Verified contract (the keystone correction)

A code-verification pass corrected a wrong assumption ("drop the compare result into the
pane"):

- **`CompareTab` reads its numeric cards from the persisted dashboard summary**
  (`summary.crime_summaries`, filtered by `place_cluster_id` + `radius_m`), **not** from the
  compare result. The compare result only feeds the single `overview.summary_text` line
  (`CompareTab.tsx:39-43, 89, 109, 156`).
- Therefore a chat-driven compare must (a) actually **run an analysis** — which persists
  `PlaceCrimeSummary` rows — and (b) the frontend must **refetch the dashboard summary**, or
  the cards show "not analyzed yet."
- `analysis_start_date`, `analysis_end_date`, and `radius_m` are **mandatory** on the
  compare/analyze request schemas with no server defaults (`app/api/dashboard_schemas.py`).
  The frontend always supplies a window (`lib/analysisDefaults.ts`, Jan 1 → today) and
  `radiusM: 250` in `dashboard_state` (`MapWorkspace.tsx:45-47, 124-132`), so the mandatory
  fields are covered; the backend adds a defensive fallback.
- Place creation is a clean in-process call:
  `create_manual_place(session, user_id_hash, ManualPlaceCreate(display_label, latitude,
  longitude))` (`app/services/manual_place_service.py:25`). Only label + coordinates are
  required (`visit_count` defaults to 1, sensitivity to `normal`); it sets
  `inferred_place_type="manual_place"`, `label_source="manual"`.
- Geocoding is in-process: `build_provider(settings).search(query) -> list[GeocodeHit]`
  (`app/geocoding/providers.py`), each hit `{label, latitude, longitude, source}`; raises
  `GeocoderUpstreamError` when the upstream is unreachable. The top hit (`[0]`) is used.

## Approved Decisions

| Decision | Choice |
|---|---|
| Result experience | Direction **A** — enriched tabs: chat narrates, the right pane shows the data |
| Enrichment level (PoC) | **Minimal** — reuse the existing tabs as-is; the win is that they fill from chat. No net-new pane UI |
| Place resolution | **Saved + geocode + auto-save** — match saved places, else geocode and persist as a real `PlaceCluster` |
| Automation | **Fully auto + transparent** — resolve/save/run/switch tab automatically, and narrate what was done ("found X at &lt;address&gt;, saved it, compared both") |
| Orchestration | **Backend-tool-driven** — the existing agent loop is the single orchestrating agent; it gains a toolbox |
| Tool shape | **Self-contained per-tab workflow tools** that resolve names internally, so the model makes one tool call per request (no model-visible resolve→act chaining) |
| PoC slice | Places + Analyze + Compare (workflows #1, #2, #8, #9, #10, #11). Routes & Export are fast-follow |

## Architecture / Runtime Path

For "compare Pike Place Market and Capitol Hill":

1. `AssistantPanel` → `POST /assistant/chat` with chat history + `dashboard_state` (always
   carries the default window + radius 250).
2. The agent plans **one** tool call: `compare_places(queries=["Pike Place Market",
   "Capitol Hill"])`.
3. The tool runs server-side, deterministically:
   - **Resolve** each query via the shared resolver (match a saved place, else geocode +
     `create_manual_place`) → `place_ids` + a per-query resolution log.
   - **Analyze** → `analyze_selected_places(...)` persists `PlaceCrimeSummary` rows at the
     chosen radius for the window.
   - **Compare** → `compare_selected_places(...)` → `overview.summary_text`.
   - Returns `{ resolved, comparison, settings_used }` (resolved ids, created/matched flags +
     addresses, the radius/dates/category used, and the comparison overview).
4. The stream carries a `tool` event (full payload) and `token` narration.
5. The new frontend bridge applies the tool result to the pane (below).
6. `CompareTab` fills with real numbers (from the refetched summary) + the overview line; the
   chat shows the transparent narrative.

The same shape generalizes: `analyze_places` drives the Analyze tab, `add_place`/
`select_places` drive the Places list + selection.

## Backend: Shared Resolver + Toolbox

### Shared resolver

`resolve_place_queries(session, user_id_hash, queries, settings) -> ResolvedPlaces`

- For each query: match an existing saved place for this user (case-insensitive
  `display_label`; PoC uses exact/normalized match, fuzzy is a later refinement). On no match,
  geocode (`build_provider(settings).search(query)`), take the top hit, and
  `create_manual_place(...)` at the hit's coordinates. The created place's `display_label` is
  the user's **query** (trimmed) — what they called it, e.g. "Capitol Hill" — not the verbose
  geocoder string. The geocoder's full label is retained as `address` for the transparent
  narration ("found Capitol Hill at &lt;address&gt;").
- Returns `place_ids` plus `matched`, `created` (`{query, place_id, label, address, source}`),
  and `unresolved` (`GeocoderUpstreamError` or no hits → query is reported unresolved, not a
  hard failure).
- Lives in a new module (e.g. `app/assistant/place_resolution.py`); it is a helper, **not** a
  model-visible tool.

### PoC toolbox (advertised in `semantic_layer.AVAILABLE_TOOLS`)

| Tool | Mirrors | Behavior | Drives | Status |
|---|---|---|---|---|
| `add_place(query)` | Places: Search / Add | resolve (geocode + create); no analysis | Places list + select it | new |
| `select_places(queries, mode?)` | Places: checkboxes | resolve (match, else create); set selection. `mode` ∈ `replace` (default) \| `add` \| `clear` covers "select X and Y", "add Z to selection", "clear selection" | selection only | new |
| `analyze_places(queries?)` | Analyze: "Run analysis" | resolve (or use selection) + `analyze_selected_places` + `neighborhood_analysis_for_places` + `incident_details_for_places`; bundle all three | Analyze tab | evolves `run_place_analysis` |
| `compare_places(queries?)` | Compare | resolve (or use selection) + analyze (persist) + `compare_selected_places` | Compare tab | evolves `compare_places` |
| `get_dashboard_summary()` | orientation | read | — | exists |
| `suggest_followups()` | next steps | static suggestions | — | exists |

Notes:

- **`analyze_places` returns the whole Analyze tab in one result** (analysis + neighborhood +
  incidents), mirroring the UI's single "Run analysis" that fires all three fetches. The
  granular `get_neighborhood_analysis` / `get_incident_details` / `run_place_analysis` are
  folded into it and not advertised separately — a 6-tool menu is far more reliable for small
  local models than a 9-tool one. (The underlying services and any non-agent callers are
  unchanged; only the agent's advertised tool surface shrinks.)
- **Settings inheritance:** radius / dates / category come from `dashboard_state`; the model
  may override inline ("…at 500m for the last 6 months"); the tool echoes the
  `settings_used` so the frontend can sync the chips. A standalone `set_analysis_settings`
  tool (workflows #5–#7) is a trivial fast-follow, not required for the PoC.
- **Backfill update:** `agent.py:_tool_arguments` / `SELECTION_TOOLS` must learn the new tools.
  The by-name tools accept a `queries` list from the model and fall back to
  `dashboard_state.selected_place_ids` when `queries` is empty; radius/dates/category continue
  to backfill from `dashboard_state`.

## Agent Loop & Prompt Policy

- The loop (`run_assistant_turn`) is unchanged in shape. The advertised toolbox and the
  per-tool argument handling change.
- `PLANNING_SYSTEM_PROMPT` gains: how to extract place names/addresses from the user's message
  into `queries`; the instruction to prefer one workflow tool per request; and a transparency
  directive to **state what was resolved/created** ("Found Capitol Hill at &lt;address&gt; and
  saved it") in the final narration.
- The existing safety-score guard (`agent.py:_asks_for_safety_score`) and reported-incident
  wording rules remain in force for all tools.

## Frontend Bridge

- Add a single `onToolResult(data)` prop to `AssistantPanel`, called from its existing `tool`
  SSE handler with the whole `event.data` (`{tool_name, arguments, result}`; already
  JSON-parsed in `client.ts`).
- `MapWorkspace` implements **one coordinated `applyAssistantToolResult(data)` action** keyed
  on `tool_name` — coordinated rather than the existing piecemeal setters, because verification
  found they sabotage one another:
  - `add_place` → refetch summary (new place appears), **append** the created place to the
    current selection (matches the UI's `selectPlaceIds` merge after a manual add).
  - `select_places` → apply `mode`: `replace` sets the selection to the resolved ids, `add`
    merges them, `clear` empties it.
  - `analyze_places` → **replace** selection with the resolved ids, **sync** `analysis`
    (radius/dates/category) from
    `settings_used`, refetch summary, store the neighborhood + incident slices, switch to
    **Analyze**.
  - `compare_places` → replace selection, sync settings, refetch summary, set the comparison
    overview, switch to **Compare**.
- Three gotchas the action must handle (all from verification):
  1. **Replace path required** — today's `selectPlaceIds` only merges into the Set
     (`MapWorkspace.tsx:155-163`). `analyze_places` / `compare_places` (and `select_places`
     `replace` mode) need the selection to be **exactly** the resolved ids, or stale prior
     selections skew the per-place cards — so a replace path is required. (`add_place` and
     `select_places` `add` mode intentionally keep the existing merge behavior.)
  2. **Sync the radius** — cards filter `crime_summaries` by `analysis.radiusM`
     (`CompareTab.tsx:41`), so `analysis.radiusM` must be set to the tool's radius or cards
     read "N/A".
  3. **Ordering** — `selectPlaceIds` calls `invalidateAnalysisContext()` which nulls
     comparison/neighborhood/incidents; the coordinated action must set the result slices
     **after** selection (one atomic update), not via independent setters.
- Result/argument payloads are typed `unknown` on the frontend; the action narrows by
  `tool_name` and casts. A small typed mirror of each tool's result shape should be added to
  `frontend/src/types.ts` to keep the bridge honest.

## Enrichment (Minimal)

No net-new pane UI in the PoC. The existing `CompareTab` / `AnalyzeTab` render the filled data;
the only "summary" is the existing `overview.summary_text` line plus the chat narration. Richer
viz (headline banners, comparison bars/sparklines) and the woven Briefing / Hybrid views
(Directions B/C) are deliberately later phases.

## Error Handling & Edge Cases

- **Geocoder unavailable / no hit** (`GeocoderUpstreamError` or empty results): the query is
  reported `unresolved`; the assistant narrates "I couldn't find X" and proceeds with whatever
  resolved. The pane is not switched if nothing usable resolved.
- **Fewer than 2 resolvable places for a compare**: the assistant explains it needs two and
  does not switch to Compare.
- **No places / empty dashboard**: existing `missing_context` paths apply; the assistant
  asks the user to add a place.
- **LLM unavailable** (`LlmUnavailable`): existing error event; the rest of the app is
  unaffected.
- **Invariant**: no tool ranks/scores by safety; `add_place`/`select_places` are neutral data
  actions; the safety-score guard + reported-incident wording cover narration.
- **Frontend robustness**: an unrecognized `tool_name` or malformed result is ignored by the
  bridge (chat still renders); the action never throws into the render path.
- **Auto-save side effects**: created places are normal `manual_place` `PlaceCluster`s scoped
  to the session user hash; they appear in the Places list and exports like any manual place.

## Security & Privacy

- All resolution and tool execution use the agent's `user_id_hash` (the route uses
  `required_public_user_hash`); assistant-created places belong to the right session.
- The model still cannot run SQL, choose arbitrary functions, fetch URLs, or read files. The
  new capability is narrowly: geocode a string and create a manual place via the existing
  validated service.
- Auto-creating places from chat is a deliberate, user-approved tradeoff (privacy-first app):
  it is transparent (narrated), reversible (places can be deleted), and uses the same
  generalization/snapping as the manual Add flow.

## Testing Requirements

Backend:

- Resolver: matches an existing saved place by label; geocodes + creates a new place on no
  match (mock geocoder); reports `unresolved` on `GeocoderUpstreamError`; scopes to the user
  hash.
- `add_place` / `select_places`: resolve and return the expected ids / created flags.
- `analyze_places`: resolves (or uses selection), persists summaries, returns the bundled
  analysis + neighborhood + incidents.
- `compare_places`: resolves, persists analysis, returns comparison overview; requires ≥2
  resolved places.
- Settings: inline overrides win over `dashboard_state`; defaults fall back sanely.
- Invariant: a safety-score request is still refused/redirected even with the new tools.
- Tool registry rejects unknown tools and invalid arguments.

Frontend:

- `applyAssistantToolResult` reducer: each `tool_name` produces the right state transition
  (replace selection, sync radius/dates/category, switch tab, set result slices).
- Ordering: setting a comparison/analysis result is not wiped by selection invalidation.
- `AssistantPanel` calls `onToolResult` with the full `event.data` from a `tool` event.
- An unrecognized tool result is ignored without crashing the panel.

Gate: `make test-all` (`pytest` + `ruff check .` + frontend `npm test` + `npm run build`).

## Delivery Slices

1. Shared resolver + tests (mock geocoder).
2. Toolbox: `add_place`, `select_places`, and the evolved `analyze_places` / `compare_places`;
   advertise the 6-tool menu; update `_tool_arguments` / `SELECTION_TOOLS`; prompt updates +
   tests.
3. Frontend bridge: `onToolResult` + coordinated `applyAssistantToolResult` + typed result
   mirrors + tests.
4. End-to-end manual smoke (resolve → analyze → compare drives the pane), then `make test-all`.

## Acceptance Criteria

- A public session can say "compare A and B" (names, not pre-selected) and the assistant
  resolves them (creating any missing place), runs the analysis, and the **Compare** tab fills
  with real numbers while the chat narrates what was resolved/created.
- "Analyze my home" drives the **Analyze** tab (verdict + incidents) the same way.
- "Add X" and "select X and Y" update the Places list / selection from chat.
- All narration uses reported-incident language; no safe/unsafe labels or rankings.
- The pane reflects the radius/dates/category the agent used (chips synced).
- `make test-all` passes.

## Goal State (north star — not PoC scope)

The agent should eventually **propose and select places itself** and interact with map/UI
objects directly — e.g. "Choose five different locations for comparison." This is the "agent
and UI become a single unified interface" end state. The PoC architecture reaches it cleanly: a
future `propose_places` tool would select candidates and feed the same `select_places` →
analyze/compare bridge. Designing the bridge as a coordinated, tool-keyed action (rather than
compare-specific) is what keeps that path open.

## Non-Goals (this PoC)

- Routes (#12) and Export (#13) workflows — fast-follow, separate slices.
- Standalone `set_analysis_settings` tool and offense-subcategory / NIBRS filters (UI exposes
  only category today).
- `delete_place` from chat (destructive — later, behind confirmation).
- Richer pane visualizations and the Briefing / Hybrid result views (Directions B/C).
- Autonomous place selection / map-object manipulation (goal-state above).
- Fuzzy / disambiguating geocode resolution (PoC uses the top hit + transparent narration).
- Persistent assistant conversation storage; new statistical methods.
