# Analyst Persona "Copper" + Upgraded Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Waypoint Analyst a persona — Copper, a fictional case-desk basset hound — via an upgraded dock (avatar header, greeting, third chip, first-visit pulse) and in-voice framing copy, per the approved spec `docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md`.

**Architecture:** Frontend-heavy: a new `CopperAvatar` inline-SVG component and copy/structure changes inside the existing `mc-dock` in `AssistantPanel.tsx`. Backend changes are two copy strings only (`_SAFETY_REDIRECT` in `app/assistant/agent.py`, a fixed lead-in in `app/assistant/summaries.py`). No layout restructuring, no API changes, no LLM-prompt changes, no guard-logic changes.

**Tech Stack:** React + TypeScript + Vitest/Testing Library (frontend), FastAPI + pytest (backend), plain CSS in `frontend/src/styles/mapWorkspace.css`.

**Spec deviation (approved by convention):** the spec names the localStorage key `waypoint.copper.greeted`; the repo's existing convention is `wp-`-prefixed keys (`wp-theme`), so we use **`wp-copper-greeted`** and amend the spec line in Task 7.

---

## Verification commands

- Backend, one file: `.venv/bin/python -m pytest tests/test_assistant_summaries.py -q`
- Backend, all: `make test` (runs `.venv/bin/python -m pytest tests -q`)
- Frontend, one file: `cd frontend && npm test -- src/components/AssistantPanel.test.tsx`
- Full gate before PR: `make test-all` (pytest + ruff + npm test + npm run build)

---

### Task 1: Implementation worktree

This repo's convention: never work in the main checkout. Worktrees need `.venv` and `frontend/node_modules` symlinked from the main checkout (they're dir-form gitignored, so add them to the worktree-local exclude; `pyproject.toml`'s pytest `pythonpath` makes worktree code win over the venv's installed copy).

**Files:** none (setup only)

- [ ] **Step 1: Create the worktree branching from the spec branch**

The spec/plan branch `analyst-copper-spec` (PR #127) is docs-only. Branch implementation from it so the spec and plan ride along; the impl PR will be opened after #127 merges (rebase onto `origin/main` at PR time if needed).

```bash
cd /Users/jscocca/Repos/waypoint
git fetch origin
git worktree add /Users/jscocca/Repos/waypoint-copper -b analyst-copper analyst-copper-spec
```

Expected: `Preparing worktree (new branch 'analyst-copper')`.

- [ ] **Step 2: Symlink the venv and node_modules; exclude them locally**

```bash
ln -s /Users/jscocca/Repos/waypoint/.venv /Users/jscocca/Repos/waypoint-copper/.venv
ln -s /Users/jscocca/Repos/waypoint/frontend/node_modules /Users/jscocca/Repos/waypoint-copper/frontend/node_modules
cd /Users/jscocca/Repos/waypoint-copper
printf '.venv\nfrontend/node_modules\n' >> "$(git rev-parse --git-dir)/info/exclude"
```

- [ ] **Step 3: Sanity-check the toolchain from the worktree**

```bash
cd /Users/jscocca/Repos/waypoint-copper
.venv/bin/python -m pytest tests/test_assistant_summaries.py -q
cd frontend && npm test -- src/components/AssistantPanel.test.tsx
```

Expected: both PASS (nothing changed yet). `git status` must show a clean tree.

---

### Task 2: Reword `_SAFETY_REDIRECT` in Copper's voice (backend)

Same meaning, same refusal enumeration, same redirect targets — only the framing changes. One existing test asserts the substring `"reported incident context"` against the redirect text, which exists only in the old wording; it flips to `"reported incident counts"`, which exists only in the new wording — giving us a real red→green cycle.

**Files:**
- Modify: `tests/test_assistant_agent.py` (1 assertion site)
- Modify: `app/assistant/agent.py:85-90`

- [ ] **Step 1: Update the test assertion**

In `tests/test_assistant_agent.py`, in `test_agent_redirects_safe_unsafe_language_without_model_call` (line ~158), replace:

```python
assert "reported incident context" in events[1].data["delta"]
```

with:

```python
assert "reported incident counts" in events[1].data["delta"]
```

(The two other occurrences of `"reported incident context"` in the file, lines ~338/347, belong to an unrelated pass-through fixture — the phrase there is incidental filler in a fake LLM final message and its echo assertion. They stay untouched.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
.venv/bin/python -m pytest tests/test_assistant_agent.py -q
```

Expected: exactly 1 FAILure, an `AssertionError` on the `"reported incident counts"` substring check.

- [ ] **Step 3: Reword the redirect**

In `app/assistant/agent.py`, replace lines 85–90:

```python
_SAFETY_REDIRECT = (
    "I can discuss reported incident context, but I can't label places safe or unsafe, rank "
    "them by safety, danger, or risk, or produce a personal safety score. I can instead order "
    "places by reported incident count or compare exposure-adjusted incident rates — just ask "
    "it that way."
)
```

with:

```python
_SAFETY_REDIRECT = (
    "That's not something I can pull from the files — I can't label places safe or unsafe, "
    "rank them by safety, danger, or risk, or produce a personal safety score. I can order "
    "places by reported incident counts or compare exposure-adjusted incident rates — just "
    "ask it that way."
)
```

Leave the comment above it and everything else untouched.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_assistant_agent.py -q
```

Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): safety redirect reworded in Copper's case-desk voice"
```

---

### Task 3: "From the reports: " lead-in on analyze/compare summaries (backend)

A fixed, deterministic prefix on the two data-bearing summaries only. The data sentence itself stays byte-identical; empty-result fallbacks and all other tools stay bare (per spec §2).

**Files:**
- Modify: `tests/test_assistant_summaries.py` (append two tests)
- Modify: `app/assistant/summaries.py:54-95`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_assistant_summaries.py` (it already defines `_envelope(tool_name, result)` at the top):

```python
def test_analyze_and_compare_summaries_carry_reports_lead_in():
    analyze = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Pike Place",
                    "place_incident_count": 3,
                    "decision": "insufficient_data",
                }
            ]
        },
    }
    assert build_tool_summary(_envelope("analyze_places", analyze)).startswith(
        "From the reports: "
    )
    compare = {
        "settings_used": {"radius_m": 250},
        "comparison": {"overview": {"options": [{"label": "A", "incident_count": 1}]}},
    }
    assert build_tool_summary(_envelope("compare_places", compare)).startswith(
        "From the reports: "
    )


def test_reports_lead_in_absent_on_empty_results_and_other_tools():
    assert build_tool_summary(_envelope("analyze_places", {})) == "No places to analyze."
    assert (
        build_tool_summary(_envelope("get_dashboard_summary", {"totals": {"place_count": 2}}))
        == "You have 2 saved places."
    )
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
.venv/bin/python -m pytest tests/test_assistant_summaries.py -q
```

Expected: 1 FAIL (`test_analyze_and_compare_summaries_carry_reports_lead_in`, AssertionError on `startswith`); the absent-lead-in test already passes.

- [ ] **Step 3: Implement the lead-in**

In `app/assistant/summaries.py`, add a module constant below `_DECISION_PHRASES` (after line 12):

```python
_REPORTS_LEAD_IN = "From the reports: "
```

In `_analyze_places_summary`, replace the line:

```python
    summary = " ".join(sentences) if sentences else "No places to analyze."
```

with:

```python
    summary = _REPORTS_LEAD_IN + " ".join(sentences) if sentences else "No places to analyze."
```

In `_compare_places_summary`, replace the line:

```python
    summary = " ".join(parts) if parts else "Compared the selected places."
```

with:

```python
    summary = _REPORTS_LEAD_IN + " ".join(parts) if parts else "Compared the selected places."
```

(Operator precedence is fine: `+` binds tighter than the conditional, so the prefix applies only to the joined sentences.)

- [ ] **Step 4: Run the backend suite to verify everything passes**

```bash
.venv/bin/python -m pytest tests/test_assistant_summaries.py tests/test_assistant_agent.py -q
```

Expected: PASS. (The agent-level output-guard test exercises these summaries too — the lead-in contains no safety lexicon, so it must stay green.)

- [ ] **Step 5: Commit**

```bash
git add app/assistant/summaries.py tests/test_assistant_summaries.py
git commit -m "feat(assistant): 'From the reports:' lead-in on analyze/compare summaries"
```

---

### Task 4: `CopperAvatar` component (frontend)

One inline-SVG component, two variants: `bust` (noir bust — fedora, trench collar; empty state, ~72px) and `mark` (head-only; header, 20px). Decorative (`aria-hidden`) — the adjacent text "Copper" carries the name. Hardcoded warm palette works on light and night surfaces. No image assets.

**Files:**
- Create: `frontend/src/components/CopperAvatar.tsx`
- Test: `frontend/src/components/CopperAvatar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/CopperAvatar.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CopperAvatar } from "./CopperAvatar";

afterEach(cleanup);

describe("CopperAvatar", () => {
  it("renders the decorative mark at the requested size", () => {
    const { container } = render(<CopperAvatar variant="mark" size={20} />);
    const svg = container.querySelector('svg[data-variant="mark"]');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
  });

  it("renders the bust variant and forwards className", () => {
    const { container } = render(
      <CopperAvatar variant="bust" size={72} className="mc-copper-pulse" />,
    );
    const svg = container.querySelector('svg[data-variant="bust"]');
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass("mc-copper-pulse");
    expect(svg).toHaveAttribute("width", "72");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm test -- src/components/CopperAvatar.test.tsx
```

Expected: FAIL — `Failed to resolve import "./CopperAvatar"`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/CopperAvatar.tsx`:

```tsx
type Props = {
  variant: "mark" | "bust";
  size?: number;
  className?: string;
};

const MARK = (
  <>
    <path d="M34 46 Q26 66 34 84 Q42 87 43 71 Q40 57 41 48 Z" fill="#6b4520" />
    <path d="M86 46 Q94 66 86 84 Q78 87 77 71 Q80 57 79 48 Z" fill="#6b4520" />
    <circle cx="60" cy="58" r="27" fill="#b5793f" />
    <ellipse cx="60" cy="42" rx="31" ry="7" fill="#33332f" />
    <path d="M40 42 Q42 22 60 22 Q78 22 80 42 Q60 35 40 42 Z" fill="#444441" />
    <rect x="41" y="34" width="38" height="5" fill="#2c2c2a" />
    <rect x="44" y="52" width="11" height="4" rx="2" fill="#8a5a2e" />
    <rect x="65" y="52" width="11" height="4" rx="2" fill="#8a5a2e" />
    <circle cx="50" cy="59" r="3" fill="#2b2b2b" />
    <circle cx="71" cy="59" r="3" fill="#2b2b2b" />
    <ellipse cx="60" cy="71" rx="12" ry="9" fill="#e2c495" />
    <ellipse cx="60" cy="66" rx="4.8" ry="3.2" fill="#2b2b2b" />
  </>
);

const BUST = (
  <>
    <path d="M34 44 Q22 72 32 96 Q41 99 43 80 Q39 60 41 47 Z" fill="#6b4520" />
    <path d="M86 44 Q98 72 88 96 Q79 99 77 80 Q81 60 79 47 Z" fill="#6b4520" />
    <path d="M28 100 Q34 80 50 78 L60 86 L70 78 Q86 80 92 100 Z" fill="#8a7a5f" />
    <path d="M50 78 L60 96 L44 92 Z" fill="#6f6249" />
    <path d="M70 78 L60 96 L76 92 Z" fill="#6f6249" />
    <polygon points="60,86 55,93 60,99 65,93" fill="#eee8da" />
    <circle cx="60" cy="54" r="25" fill="#b5793f" />
    <ellipse cx="60" cy="38" rx="30" ry="7" fill="#33332f" />
    <path d="M40 38 Q42 20 60 20 Q78 20 80 38 Q60 32 40 38 Z" fill="#444441" />
    <rect x="41" y="31" width="38" height="5" fill="#2c2c2a" />
    <rect x="44" y="48" width="11" height="4" rx="2" fill="#8a5a2e" />
    <rect x="65" y="48" width="11" height="4" rx="2" fill="#8a5a2e" />
    <circle cx="50" cy="55" r="3" fill="#2b2b2b" />
    <circle cx="71" cy="55" r="3" fill="#2b2b2b" />
    <ellipse cx="60" cy="67" rx="12" ry="9" fill="#e2c495" />
    <ellipse cx="60" cy="62" rx="4.8" ry="3.2" fill="#2b2b2b" />
    <path
      d="M60 66 Q60 71 54 71"
      stroke="#6b4520"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
    />
  </>
);

export function CopperAvatar({ variant, size = 20, className }: Props) {
  return (
    <svg
      data-variant={variant}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      {variant === "mark" ? MARK : BUST}
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm test -- src/components/CopperAvatar.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CopperAvatar.tsx frontend/src/components/CopperAvatar.test.tsx
git commit -m "feat(frontend): CopperAvatar inline-SVG component (mark + bust variants)"
```

---

### Task 5: Dock header, empty state, and offline copy (frontend)

Header gets the 20px mark + "Copper" + role subtitle + in-voice status; empty state gets the 72px bust + greeting + third chip; `OFFLINE_MESSAGE` reworded. `aria-label="Analyst"` on the `<aside>`, the textarea label, and the collapse button labels are unchanged (spec §3).

**Files:**
- Modify: `frontend/src/components/AssistantPanel.tsx`
- Modify: `frontend/src/components/AssistantPanel.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css:102-103`

- [ ] **Step 1: Update existing tests + add header/chip expectations**

In `frontend/src/components/AssistantPanel.test.tsx`:

a) In the test `"renders the backend error message instead of a blanket offline"`, replace:

```tsx
    expect(screen.queryByText(/analyst is offline/i)).not.toBeInTheDocument();
```

with:

```tsx
    expect(screen.queryByText(/can't reach the case files/i)).not.toBeInTheDocument();
```

b) In the test `"falls back to the offline copy on a transport failure"`, replace:

```tsx
    expect(await screen.findByText(/analyst is offline/i)).toBeInTheDocument();
```

with:

```tsx
    expect(await screen.findByText(/can't reach the case files/i)).toBeInTheDocument();
```

c) In the test `"shows the explainer and quick actions when empty, and a chip sends its prompt"`, replace:

```tsx
    expect(screen.getByText("Ask about what the map is showing")).toBeInTheDocument();
```

with:

```tsx
    expect(
      screen.getByText("Copper, case desk. Point me at a place and I'll pull the reports near it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What's on file around here?" })).toBeInTheDocument();
```

d) Add a new test at the end of the `describe` block:

```tsx
  it("shows Copper's header with the idle status and avatar mark", () => {
    const { container } = render(
      <AssistantPanel dashboardState={dashboardState} onToolResult={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: /copper/i })).toBeInTheDocument();
    expect(screen.getByText("At the desk")).toBeInTheDocument();
    expect(container.querySelector('svg[data-variant="mark"]')).not.toBeNull();
    expect(container.querySelector('svg[data-variant="bust"]')).not.toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify the changed ones fail**

```bash
cd frontend && npm test -- src/components/AssistantPanel.test.tsx
```

Expected: 4 FAILures (the two offline-copy tests, the empty-state test, the new header test).

- [ ] **Step 3: Implement the panel changes**

In `frontend/src/components/AssistantPanel.tsx`:

a) Add the import after the existing imports (line 4 area):

```tsx
import { CopperAvatar } from "./CopperAvatar";
```

b) Replace the `OFFLINE_MESSAGE` constant (lines 16–17):

```tsx
const OFFLINE_MESSAGE =
  "Copper can't reach the case files right now. Your data is unaffected — the rest of Waypoint works.";
```

c) Add a prompts constant below `OFFLINE_MESSAGE`:

```tsx
const SUGGESTED_PROMPTS = [
  "What's near this pin?",
  "Compare my places",
  "What's on file around here?",
];
```

d) Replace the header block (lines 90–102, the `mc-dock-head` div):

```tsx
      <div className="mc-dock-head">
        <h3>
          <CopperAvatar variant="mark" size={20} />
          Copper
          <span className="mc-dock-role">case desk · analyst</span>
        </h3>
        <span className="mc-dock-status">{sending ? "Checking the files…" : "At the desk"}</span>
        <button
          type="button"
          className="mc-dock-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand analyst" : "Collapse analyst"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d={collapsed ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
        </button>
      </div>
```

e) Replace the empty state (the `mc-dock-empty` div, lines 118–128):

```tsx
              <div className="mc-dock-empty">
                <CopperAvatar variant="bust" size={72} />
                <p>Copper, case desk. Point me at a place and I'll pull the reports near it.</p>
                <div className="mc-dock-chips">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button key={prompt} type="button" className="mc-chip" disabled={sending}
                      onClick={() => void sendTurn([...messages, { role: "user", content: prompt }])}>
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
```

f) In `frontend/src/styles/mapWorkspace.css`, replace lines 102–103:

```css
.mc-dock-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);}
.mc-dock-head span{font-family:var(--f-mono);font-size:10.5px;color:var(--text-dim);margin-right:auto;}
```

with:

```css
.mc-dock-role{font-family:var(--f-mono);font-size:9.5px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim);}
.mc-dock-status{font-family:var(--f-mono);font-size:10.5px;color:var(--text-dim);margin-right:auto;}
```

(The generic `.mc-dock-head span` selector must go — it would drag `margin-right:auto` onto the new role span.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test -- src/components/AssistantPanel.test.tsx
```

Expected: PASS (all tests in the file). Also run the full frontend suite once — `MapWorkspace.test.tsx` mounts the dock indirectly:

```bash
cd frontend && npm test
```

Expected: PASS. (Verified: `MapWorkspace.test.tsx` references the dock only via the unchanged "Analyst message" textarea label — no assertions on the old header strings.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssistantPanel.tsx frontend/src/components/AssistantPanel.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): Copper header, greeting empty state, in-voice status + offline copy"
```

---

### Task 6: First-visit pulse (frontend)

Until the user sends their first assistant message ever (`wp-copper-greeted` unset), the header mark plays a subtle two-cycle pulse on load. Sending any message (typed or chip) sets the flag. Reduced-motion users get no animation (CSS, spec §4).

**Files:**
- Modify: `frontend/src/components/AssistantPanel.tsx`
- Modify: `frontend/src/components/AssistantPanel.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css` (pulse keyframes + reduced-motion list at line ~304)

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/AssistantPanel.test.tsx`, add `localStorage.clear();` to the existing `afterEach` block:

```tsx
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
```

Then add two tests at the end of the `describe` block:

```tsx
  it("pulses the avatar until the first message is sent, then sets the greeted flag", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse("event: done\ndata: {}\n\n"));
    const { container } = render(<AssistantPanel dashboardState={dashboardState} />);
    expect(container.querySelector("svg.mc-copper-pulse")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(container.querySelector("svg.mc-copper-pulse")).toBeNull());
    expect(localStorage.getItem("wp-copper-greeted")).toBe("1");
  });

  it("does not pulse when previously greeted", () => {
    localStorage.setItem("wp-copper-greeted", "1");
    const { container } = render(<AssistantPanel dashboardState={dashboardState} />);
    expect(container.querySelector("svg.mc-copper-pulse")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test -- src/components/AssistantPanel.test.tsx
```

Expected: 1 FAIL (`pulses the avatar…` — no `.mc-copper-pulse` element exists yet); the `does not pulse` test passes vacuously.

- [ ] **Step 3: Implement the pulse gating**

In `frontend/src/components/AssistantPanel.tsx`:

a) Add below `SUGGESTED_PROMPTS`:

```tsx
const GREETED_KEY = "wp-copper-greeted";
```

b) Add state next to the existing `useState` calls inside the component:

```tsx
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");
```

c) At the top of `sendTurn` (before `let assistantText = "";`):

```tsx
    if (!greeted) {
      localStorage.setItem(GREETED_KEY, "1");
      setGreeted(true);
    }
```

d) Gate the class on the header mark:

```tsx
          <CopperAvatar variant="mark" size={20} className={greeted ? undefined : "mc-copper-pulse"} />
```

e) In `frontend/src/styles/mapWorkspace.css`, add after the `.mc-dock-status` rule:

```css
@keyframes copper-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.18);}}
.mc-copper-pulse{animation:copper-pulse 1.6s ease-in-out 2;transform-origin:center;}
```

and extend the existing reduced-motion rule (line ~304) by adding `.mc-copper-pulse` to its selector list:

```css
@media (prefers-reduced-motion: reduce){
  .pin .body,.halo,.mc-workspace-panel,.mc-panel.is-active,.mc-searchpill-pin.is-armed,.mc-skeleton,.mc-copper-pulse{animation:none !important;}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test -- src/components/AssistantPanel.test.tsx
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssistantPanel.tsx frontend/src/components/AssistantPanel.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(frontend): first-visit pulse on Copper's mark (wp-copper-greeted, reduced-motion safe)"
```

---

### Task 7: Docs — persona note, DEMO beat, roadmap entry, spec key amendment

**Files:**
- Modify: `docs/architecture/assistant.md` (after the intro/verified-against lines)
- Modify: `docs/DEMO.md` ("What it is" section)
- Modify: `docs/ROADMAP.md` (Phase 7 section, before Slice 3)
- Modify: `docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md` (§4 key name)

- [ ] **Step 1: Persona note in the architecture doc**

In `docs/architecture/assistant.md`, insert after the `> Verified against …` line and before the first `---`:

```markdown
## Persona — "Copper, case desk"

The Analyst presents as **Copper**, a fictional basset-hound detective at the case desk
(spec: `docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md`). The persona is
chrome + framing copy only: the `CopperAvatar` mark/bust SVGs and greeting/status/offline
strings in `AssistantPanel.tsx`, the in-voice `_SAFETY_REDIRECT`, and a fixed
"From the reports: " lead-in on `analyze_places`/`compare_places` summaries. Data content,
the guards, and the planning prompt carry no persona. Copper wears no SPD insignia and never
claims official status; "analyst" remains the product term (and the dock's aria-label).
```

- [ ] **Step 2: DEMO.md beat**

In `docs/DEMO.md`, at the end of the `## What it is` section, add:

```markdown
The Analyst chat presents as **Copper**, a fictional case-desk hound — point the demo
audience at the dock, ask "What's on file around here?", and let him pull the reports.
```

- [ ] **Step 3: Roadmap entry**

In `docs/ROADMAP.md`, in the Phase 7 section, insert before the `- [ ] **Slice 3 — Write-up:**` bullet:

```markdown
- [x] **Follow-up — Analyst persona "Copper" + upgraded dock:** the Analyst presents as
  Copper, a fictional case-desk basset hound (noir bust; no SPD insignia, never claims
  official status) — avatar header + in-voice status, greeting empty state with a third
  deictic chip, one-time first-visit pulse (reduced-motion safe), reworded safety redirect,
  and a "From the reports:" lead-in on analyze/compare summaries. Chrome + framing copy
  only; guards, data content, and the planning prompt untouched. Spec:
  `docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md`.
```

- [ ] **Step 4: Spec key amendment**

In `docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md` §4, replace:

```markdown
- `localStorage` key `waypoint.copper.greeted`, unset → the avatar mark plays a
```

with:

```markdown
- `localStorage` key `wp-copper-greeted` (repo convention, cf. `wp-theme`), unset → the
  avatar mark plays a
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/assistant.md docs/DEMO.md docs/ROADMAP.md docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md
git commit -m "docs: Copper persona note, demo beat, roadmap tick, spec key amendment"
```

---

### Task 8: Full gate, push, PR

**Files:** none

- [ ] **Step 1: Run the full verification gate**

```bash
cd /Users/jscocca/Repos/waypoint-copper && make test-all
```

Expected: pytest PASS, `ruff check .` clean, frontend tests PASS, `npm run build` succeeds. Fix anything that fails before proceeding (and re-run until green).

- [ ] **Step 2: Visual sanity check (optional but recommended)**

If the dev stack is available: `make run`, open the dashboard, confirm the dock shows Copper's mark + "At the desk", the bust + greeting when empty, the pulse on a fresh profile (and its absence after sending a message), in both light and night mode. This is a copy/visual slice — eyes on it beat tests alone.

- [ ] **Step 3: Push and open the PR**

If PR #127 (spec+plan docs branch) has already been squash-merged, rebase first: `git fetch origin && git rebase origin/main`.

```bash
git push -u origin analyst-copper
gh pr create --title "feat(assistant): Copper persona + upgraded dock (Phase 7)" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-10-analyst-copper-persona-design.md (plan: docs/superpowers/plans/2026-07-10-analyst-copper-persona.md).

- CopperAvatar inline-SVG component (mark + bust), no image assets
- Dock header: mark + "Copper" + case-desk role line, in-voice status
- Empty state: bust + greeting + third deictic chip
- First-visit pulse gated by wp-copper-greeted, reduced-motion safe
- Backend copy only: _SAFETY_REDIRECT in-voice (same meaning), "From the reports:" lead-in on analyze/compare summaries
- Guards, data content, planning prompt, API surface: untouched
- Docs: assistant.md persona note, DEMO.md beat, roadmap tick

Gate: make test-all green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. User squash-merges per repo cadence.
