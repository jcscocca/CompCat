# Analyst Knob Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Analyst adjusts analysis parameters conversationally ("increase radius to 500") and re-runs, with the changed knob synced to the dashboard controls.

**Architecture:** Discovery during planning found spec components 2–3 (the `settings_used` echo on analyze/compare tool results, and the frontend bridge lifting it into the controls without invalidation — `app/assistant/tools.py::_settings_used`, `frontend/src/lib/assistantBridge.ts::settingsFrom`) are **already implemented and tested** (from #62). The live failure is entirely component 1: `PLANNING_SYSTEM_PROMPT` never documents the tool argument fields, so the model can't emit them (and pydantic silently drops guessed names). This plan is therefore: the prompt knob block + pin test, two regression pins on the existing override/echo contract, and reconciling the spec doc with reality.

**Tech Stack:** Python/pytest (prompt + agent tests). No frontend changes required.

**Worktree:** `/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/analyst-knob-impl` (branch `analyst-knob-impl`; `.venv` and `frontend/node_modules` symlinks already in place). Run backend tests as `.venv/bin/python -m pytest …`.

---

### Task 1: Planner prompt knob block + pin test

**Files:**
- Modify: `app/assistant/prompts.py` (append to `PLANNING_SYSTEM_PROMPT`, after the deictic-references block that ends "…instead of calling a tool.")
- Test: `tests/test_assistant_tools.py` (append after `test_planning_prompt_routes_deictic_references_to_selection`)

- [ ] **Step 1: Write the failing pin test**

```python
def test_planning_prompt_documents_adjustable_knobs():
    """"Increase radius to 500" failed live: the planner was never told the tools'
    argument fields, and pydantic drops unknown names (e.g. a guessed "radius")."""
    from app.assistant.prompts import PLANNING_SYSTEM_PROMPT

    text = PLANNING_SYSTEM_PROMPT.lower()
    assert '"radii_m"' in text
    assert '"radius_m"' in text
    assert "analysis_start_date" in text
    assert "available_radii_m" in text
    assert "only the changed" in text
    assert "stating the parameter" in text
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_tools.py::test_planning_prompt_documents_adjustable_knobs -q`
Expected: FAIL with `AssertionError`.

- [ ] **Step 3: Append the knob block to `PLANNING_SYSTEM_PROMPT`**

Insert immediately after the deictic block's final sentence ("…ask the\nuser to select or name a place instead of calling a tool.") and before "During planning, respond with ONE JSON object…":

```text
Analysis parameters ("knobs") you may adjust when the user asks: pass only the changed
field(s) in "arguments" — everything you omit is filled from the current dashboard
state, so never restate unchanged knobs.
- Radius: analyze_places takes "radii_m", a list of meters (e.g. {"radii_m": [500]});
  compare_places takes "radius_m", a single integer up to 5000 (e.g. {"radius_m": 500}).
- Date window: "analysis_start_date" / "analysis_end_date" (YYYY-MM-DD). Resolve
  relative asks ("last 6 months") against the active window's end date in
  active_filters.
- Offense filter: "offense_category" (or null to clear it back to all).
- Data layer: "layer" is "reported", "arrests", or "calls" (e.g. "same thing for 911
  calls" means {"layer": "calls"}), keeping the layer-framing rules above.
A vague "increase/decrease the radius" means the next/previous value in
available_radii_m relative to the current one in active_filters. Whenever a result
came from an adjusted knob, begin your final answer by stating the parameter used,
e.g. "At 500 m: ...".
```

(Plain text inside the existing triple-quoted string; keep the surrounding blocks untouched.)

- [ ] **Step 4: Run the test file to confirm pass + no regressions**

Run: `.venv/bin/python -m pytest tests/test_assistant_tools.py -q`
Expected: all pass (18 tests: 17 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add app/assistant/prompts.py tests/test_assistant_tools.py
git commit -m "feat(assistant): teach the planner the adjustable analysis knobs"
```

---

### Task 2: Regression pins — model knob args beat the dashboard backfill

The behavior exists (`_tool_arguments` merges model args over defaults, `agent.py:307`) but is not pinned for the knob fields specifically. These tests are expected to PASS immediately — they are pins against future regression of the exact contract "increase radius to 500" depends on, not TDD failures.

**Files:**
- Test: `tests/test_assistant_agent.py` (append after `test_neighborhood_tool_arguments_are_backfilled_from_dashboard_state`, which defines the `_state()` pattern to copy — read it first and reuse its `AssistantDashboardState` construction verbatim)

- [ ] **Step 1: Write the two pin tests**

```python
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
```

If `AssistantDashboardState` / `date` imports are missing at module top, match the import style already used by the neighboring backfill test (it constructs the same state — copy its exact constructor shape if it differs from the above).

- [ ] **Step 2: Run them**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py -q -k "override_beats"`
Expected: 2 passed (immediately — these pin existing behavior). If either FAILS, stop: that is a real bug in the merge order — report it rather than adapting the test.

- [ ] **Step 3: Commit**

```bash
git add tests/test_assistant_agent.py
git commit -m "test(assistant): pin model knob args overriding the dashboard backfill"
```

---

### Task 3: Reconcile the spec with discovered reality

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-analyst-knob-control-design.md`

- [ ] **Step 1: Add a discovery note**

Insert under the `## Components` heading, before component 1:

```markdown
> **Plan-time discovery (2026-07-10):** components 2 and 3 below were found already
> implemented and tested (shipped with #62): the echo exists as `settings_used`
> (`app/assistant/tools.py::_settings_used`) — not the `params_used` name this spec
> proposed — and the frontend bridge (`assistantBridge.ts::settingsFrom` →
> `effect.settings`, applied without invalidation in `MapWorkspace`) already lifts
> radius/dates/category/layer into the controls. Only component 1 (the planner prompt)
> required implementation; components 2–3 got regression pins instead of new code.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-10-analyst-knob-control-design.md
git commit -m "docs: knob-control spec — components 2-3 discovered already shipped"
```

---

### Task 4: Gate + PR

- [ ] **Step 1: Full verification gate**

Run: `make test-all` (from the worktree root)
Expected: backend green (530+ passed), ruff clean, frontend tests + build green (unchanged).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin analyst-knob-impl
gh pr create --title "feat(assistant): conversational knob control — radius/dates/category/layer" --body "Implements docs/superpowers/specs/2026-07-10-analyst-knob-control-design.md (#122).

Plan-time discovery: the settings echo + frontend control-lift already shipped (#62) — the live failure was purely the planner prompt never documenting the tools' argument fields (pydantic silently drops guessed names like \`radius\`). This PR: the prompt knob block (exact field names incl. the radii_m-vs-radius_m trap, only-pass-changed-knobs rule, vague-step rule via available_radii_m, state-the-parameter rule) + pin test, and regression pins on model-args-beat-backfill.

Live replay on the tunnel demo after merge: compare at 250 m → \"what if we increase the radius\" → \"increase radius to 500\".

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

### Task 5: Live tunnel replay (post-merge, needs the user + ThinkPad)

Not a code task. After the PR merges: on the ThinkPad `git pull`, re-run `scripts/demo/start-demo.ps1` (rebuild picks up the prompt), then in the demo UI with two places selected and compare on screen at 250 m, replay: *"what if we increase the radius"* (expect: auto-step to 500 m, answer opens "At 500 m: …", radius picker moves) then *"increase radius to 500"* variants and a follow-up question (expect: 500 m sticks). If the model still misroutes, capture the api-container log lines and report — model swap (`MCA_LLM_MODEL`) before prompt surgery.

---

## Self-review notes

- **Spec coverage:** component 1 → Task 1; components 2–3 → verified existing + pinned (Task 2) + spec note (Task 3); live replay → Task 5. Error handling and invariant sections need no tasks (existing paths; prompt adds no scoring surface).
- **Type consistency:** `_tool_arguments(tool_name, state, model_args)` signature matches `app/assistant/agent.py:262`; `settings_used` fields match `tools.py::_settings_used`.
- **Honest TDD note:** Task 2's tests pin existing behavior and are expected to pass on first run; Task 1 is genuine red→green.
