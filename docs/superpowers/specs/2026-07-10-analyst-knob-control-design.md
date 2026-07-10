# Analyst knob control — design

**Date:** 2026-07-10 · **Status:** approved design, pre-plan.
**Scope:** one slice, backend + frontend, no migration. Emerged from live testing of the
Phase 7 slice-2 tunnel demo (Groq-backed Analyst).

## Why

Observed live: with a compare on screen at 250 m, the turns *"what if we increase the
radius"* and *"increase radius to 500"* both returned the identical 250 m answer. Root
cause has two independent halves:

1. **The planner is never told the knobs exist.** `AnalyzePlacesArgs` / 
   `ComparePlacesByNameArgs` already accept `radii_m` / `radius_m`, dates, offense
   filters, and `layer` — and model-supplied arguments already override the dashboard
   backfill (`_tool_arguments`, `app/assistant/agent.py` — `merged.update(arguments)`).
   But `PLANNING_SYSTEM_PROMPT` documents only the `queries` convention, and pydantic
   silently drops unknown fields, so a guessed `"radius": 500` vanishes and the backfill
   re-injects the UI's 250 m.
2. **Nothing would stick anyway.** The frontend owns the dashboard state; assistant-run
   results populate the panes (`applyAssistant` in `useAnalyze` / `useCompare`) but never
   move the *controls*, so the next turn's `dashboard_state` — and therefore the backfill
   — snaps back to the old values, and the pane/picker can disagree with the chat.

## Decisions (brainstormed & approved 2026-07-10)

| Question | Decision | Rationale |
|---|---|---|
| Knob changes vs UI | **Sync the UI controls** (radius picker, dates, category, layer toggle move to what the Analyst ran; pane re-renders) | UI never lies about what's shown; stickiness falls out free — the next turn's backfill reads the updated state. |
| Vague asks ("increase the radius") | **Auto-step and say so** — adjacent preset from `available_radii_m` (250→500→1000), answer opens "At 500 m: …" | One turn, no clarify round-trip; the stated choice makes the guess correctable. |
| Knob scope | **All filters** — radius, date range, offense category/subcategory, and the data layer (the global Reported/Arrests/Calls toggle moves too) | Symmetric; all fields already exist on the tools; one prompt block. |
| Mechanism | **Prompt + args-echo through the existing bridge** — no new tool, no server-side state | A `set_filters` tool would force a second LLM round-trip per adjustment (the decision tree deliberately spends one model call per turn); server-side sticky overrides break the frontend-owns-state architecture. Both rejected. |

## Components

> **Plan-time discovery (2026-07-10):** components 2 and 3 below were found already
> implemented and tested (shipped with #62): the echo exists as `settings_used`
> (`app/assistant/tools.py::_settings_used`) — not the `params_used` name this spec
> proposed — and the frontend bridge (`assistantBridge.ts::settingsFrom` →
> `effect.settings`, applied without invalidation in `MapWorkspace`) already lifts
> radius/dates/category/layer into the controls. Only component 1 (the planner prompt)
> required implementation; components 2–3 got regression pins instead of new code.

### 1. Planner prompt: the knob block (`app/assistant/prompts.py`)

Append to `PLANNING_SYSTEM_PROMPT`, alongside the existing queries/deictic rules:

- The exact argument fields per tool — `radii_m` (list, analyze_places) vs `radius_m`
  (single int ≤ 5000, compare_places) named explicitly (the naming trap that ate the
  live `500`), `analysis_start_date` / `analysis_end_date` (ISO dates),
  `offense_category` / `offense_subcategory`, `layer` (`reported` / `arrests` / `calls`).
- Adjustment semantics: when the user asks to change a knob, re-call the appropriate
  workflow tool passing ONLY the changed knob(s) as arguments — everything else is
  backfilled from the current dashboard state automatically; do not restate unchanged
  values.
- Vague steps: "increase/decrease the radius" → the adjacent value in
  `available_radii_m` (visible in the semantic context); the final answer MUST open by
  stating the parameter used ("At 500 m: …").
- Relative dates: "last 6 months" → concrete ISO dates computed from the context's
  current date.
- Layer switches by name ("same thing for 911 calls" → `layer: "calls"`), keeping the
  existing layer-framing rules.

### 2. Args echo: `params_used` on tool results (`app/assistant/tools.py`)

`analyze_places` and `compare_places` result payloads gain a `params_used` object — the
post-merge values the run actually used: `{radii_m | radius_m, analysis_start_date,
analysis_end_date, offense_category, offense_subcategory, nibrs_group, layer}`. The
deterministic summary already reports counts per radius; where natural, it should read
from `params_used` so chat text and payload can't diverge.

### 3. Control lift: bridge applies `params_used` (frontend)

The existing `onToolResult` → `applyAssistant` path gains the control-sync:

- `useAnalyze.applyAssistant` and `useCompare.applyAssistant` accept `params_used` and
  update the owning state for radius selection, date inputs, and offense-category
  filter before rendering results.
- The `layer` value routes to the global layer-toggle state (it lives with the top-bar
  toggle, not the per-tab hooks — wired where `MapWorkspace` dispatches `onToolResult`
  by `tool_name`).
- Analysis-context invalidation must NOT fire for an assistant-driven control change
  (the new results arrive in the same event) — the lift and the result-apply happen
  together, not as a user edit.

Stickiness needs no further work: the next turn's `dashboard_state` reflects the moved
controls, so `_tool_arguments` backfills the new values.

## Error handling

Existing paths cover the new surface: radius > 5000 m fails `ComparePlacesByNameArgs`
validation → clarification; missing window still trips `_require_analysis_window`;
unknown categories surface as clarifications. No new error machinery.

## Invariant checkpoint

Knobs are filters, not scores. The safety-refusal guard (input and output side) is
untouched; layer switches keep the existing arrests/calls framing rules already in the
prompt. No new copy ranks or rates places.

## Testing

- **Prompt pin** (pattern of the deictic test in `tests/test_assistant_tools.py`):
  asserts the knob block names `radii_m`, `radius_m`, `analysis_start_date`,
  `available_radii_m`-stepping, and the state-the-parameter rule.
- **Backend units:** `params_used` present and post-merge-accurate on both tools'
  results; model-arg-overrides-backfill for `radius_m`/`radii_m` (extend the existing
  `_tool_arguments` tests).
- **Frontend units:** `applyAssistant` lifts radius/dates/category (per hook); a
  `MapWorkspace` bridge test that a `params_used.layer` change moves the global toggle;
  invalidation does not fire on assistant-driven lifts.
- **Live (post-merge, on the tunnel demo):** replay the failing transcript — compare at
  250 m, "what if we increase the radius", "increase radius to 500" — expect stepped
  radius, synced picker, sticky follow-ups.

## Out of scope

- New tools or multi-call planning; server-side conversation state.
- Knobs beyond the existing tool fields (e.g. changing `available_radii_m` presets).
- Prompt work for models other than verifying on the demo's current Groq model.
