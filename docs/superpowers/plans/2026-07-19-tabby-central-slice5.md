# Tabby-Central Slice 5: Proactive Moments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tabby-led onboarding replaces the static landing panel, and user-driven place adds get a deterministic "pull the reports near this?" offer — with the auto-run paths audited so proactivity never double-fires.

**Architecture:** The fresh-session `showLanding` override and the `AddressLookup` panel are removed; the rail's empty state gains ACTION chips (focus search / start add-pin / open manual add) alongside the existing prompt chips. The three user add paths (pin-draft save, manual add, CSV import — all funneling through `selectPlaceIds`, per survey) pass their created place data through a widened `selectPlaceIds(ids, savedPlaces?)`, which appends a deterministic offer line + command chips when no auto-run is armed. Offers reuse the follow-up chip row via an optional full-`args` field on `FollowupChip`. LLM-driven `add_place` flows through the bridge (never `selectPlaceIds`) and keeps its own narration — no offer. Share-link / restored-session / lookup auto-runs are untouched and test-pinned as single-fire.

**Tech Stack:** React 18 + Vitest only — zero backend changes.

**Spec:** `docs/superpowers/specs/2026-07-19-tabby-central-redesign-design.md` (Slice 5). All templates deterministic — no LLM calls. Product note (parked decision, now resolved): an unsaved draft pin gets its offer AFTER save — the offer fires on persistence, not on drop.

**Worktree:** from `main`; usual setup + gates.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/src/lib/offers.ts` (+test) | create | `offerForPlaces(saved, analysis)` — deterministic text + chips |
| `frontend/src/lib/followupChips.ts` | modify | `FollowupChip.args?` full-args override |
| `frontend/src/components/AssistantPanel.tsx` (+test) | modify | onboarding empty state + action chips |
| `frontend/src/components/SearchPill.tsx` | modify | stable input id for external focus |
| `frontend/src/components/MapWorkspace.tsx` (+test) | modify | drop landing; offer state + guards; action routing |
| `frontend/src/components/AddressLookup.tsx` (+test) | delete | superseded by onboarding |
| `frontend/src/lib/usePinDraft.ts` | modify | pass the created place through `selectPlaceIds` |

---

### Task 1: Onboarding empty state, landing removal

**Files:** Modify `frontend/src/components/AssistantPanel.tsx` (+test), `frontend/src/components/SearchPill.tsx`, `frontend/src/components/MapWorkspace.tsx` (+test); delete `frontend/src/components/AddressLookup.tsx` (+its test; grep first that nothing else imports it).

- [ ] **Step 1 (TDD, panel):** `SuggestedAction` gains `action?: "search" | "add-pin" | "manual"` (mutually exclusive with `command`); new panel prop `onAction: (action: "search" | "add-pin" | "manual") => void`. Empty state becomes two chip groups driven by a new prop `hasPlaces: boolean`:
  - `hasPlaces === false` (fresh session): greeting text `"Tabby, case desk. Point me at a place — search an address, drop a pin, or add one by hand — and I'll pull the reports near it."` with action chips `[{label: "Search an address", action: "search"}, {label: "Drop a pin", action: "add-pin"}, {label: "Add places manually", action: "manual"}]`.
  - `hasPlaces === true`: existing greeting + `SUGGESTED_ACTIONS` unchanged.
  Chip click: `action` → `onAction(action)`; `command` → `onRunCommand`; else `onSend`. Tests: fresh-session chips render + route to `onAction` with the right token; has-places state unchanged; action chips disabled while `busy` but NOT gated on `offline` (they're pure UI).
- [ ] **Step 2:** `SearchPill.tsx` — add `id="mc-search-input"` to the input (one attribute; no ref plumbing).
- [ ] **Step 3 (MapWorkspace):**
  - Delete the `showLanding` const and the `{showLanding ? <AddressLookup .../> : ...}` branch — the rail (or legacy views) render unconditionally now. Remove the `AddressLookup` import; delete the component + its test file.
  - `handlePanelAction(action)`: `"search"` → `document.getElementById("mc-search-input")?.focus()`; `"add-pin"` → `pinDraft.startAddPin()`; `"manual"` → `setManagePlaces("manual")`.
  - Pass `hasPlaces={data.places.length > 0 || list.entries.length > 0}` and `onAction={handlePanelAction}`.
  - Test migration: landing-dependent tests (AddressLookup queries) re-target the onboarding chips; "Add places manually" now lives on the rail chip. Do not weaken protected classes.
- [ ] **Step 4:** suites + tsc green; commit `feat(rail): Tabby onboarding replaces the landing panel`.

---

### Task 2: Place-added offers + auto-run audit

**Files:** Create `frontend/src/lib/offers.ts` (+test); modify `frontend/src/lib/followupChips.ts` (+test), `frontend/src/lib/usePinDraft.ts`, `frontend/src/components/MapWorkspace.tsx` (+test).

- [ ] **Step 1 (TDD, offers lib):**

```ts
// frontend/src/lib/offers.ts
import type { AnalysisSettings } from "../types";
import type { FollowupChip } from "./followupChips";

export type SavedPlaceRef = { id: string; display_label: string };

/** Deterministic post-add offer. No LLM — must work in degraded mode. */
export function offerForPlaces(
  saved: SavedPlaceRef[],
  analysis: AnalysisSettings,
  savedIdCount: number,
): { text: string; chips: FollowupChip[] } | null {
  if (saved.length === 0) return null;
  const windowArgs = {
    analysis_start_date: analysis.startDate || null,
    analysis_end_date: analysis.endDate || null,
    layer: analysis.layer,
    ...(analysis.offenseCategory ? { offense_category: analysis.offenseCategory } : {}),
  };
  const ids = saved.map((p) => p.id);
  if (saved.length === 1) {
    const label = saved[0].display_label;
    const chips: FollowupChip[] = [
      {
        label: `Pull reports near ${label}`,
        command: "analyze_places",
        argsPatch: {},
        settingsPatch: {},
        args: { place_ids: ids, radii_m: [analysis.radiusM], ...windowArgs },
      },
    ];
    if (savedIdCount > 1) {
      chips.push({
        label: "Compare with my places",
        command: "compare_places",
        argsPatch: {},
        settingsPatch: {},
        args: { radius_m: analysis.radiusM, ...windowArgs }, // place_ids filled by the caller (all saved)
      });
    }
    return { text: `Saved ${label}. Want me to pull what's on file nearby?`, chips };
  }
  return {
    text: `Saved ${saved.length} places. Want me to compare them?`,
    chips: [
      {
        label: `Compare these ${saved.length} places`,
        command: "compare_places",
        argsPatch: {},
        settingsPatch: {},
        args: { place_ids: ids, radius_m: analysis.radiusM, ...windowArgs },
      },
    ],
  };
}
```

Tests: single place (chips + text incl. label; compare chip only when `savedIdCount > 1`); multi-place import; empty input → null; window args frozen from the passed analysis; degraded-safe (pure function, trivially).

- [ ] **Step 2:** `FollowupChip` gains `args?: Record<string, unknown>` (full-args override; doc comment: when present, run the command with these args verbatim — strip null/undefined — instead of `buildRerunArgs`). `handleFollowupChip` branches:

```ts
function handleFollowupChip(chip: FollowupChip) {
  setOffer(null); // any chip use consumes the offer
  if (chip.args) {
    const args = { ...chip.args };
    if (chip.command === "compare_places" && !args.place_ids) args.place_ids = Array.from(savedIdSet);
    for (const key of Object.keys(args)) if (args[key] == null) delete args[key];
    void turn.runCommand(chip.label, chip.command, args);
    return;
  }
  if (!latestCard) return;
  void turn.runCommand(chip.label, chip.command, buildRerunArgs(latestCard, chip));
}
```

- [ ] **Step 3 (workspace wiring + guards):**
  - `const [offer, setOffer] = useState<{ text: string; chips: FollowupChip[] } | null>(null);` — chip row becomes `const chipRow = offer?.chips ?? followupChips;` (pass as `followupChips={chipRow}`).
  - `selectPlaceIds(ids: string[], savedPlaces?: SavedPlaceRef[])`: after the existing body, when `savedPlaces?.length && !pendingAutoRun`, build `offerForPlaces(savedPlaces, analysis, savedIdSet.size + savedPlaces.length)`; if non-null: `thread.append({ kind: "tabby_text", text: offer.text }); setOffer(offer);`. (The `pendingAutoRun` guard is the audit codified — lookup/share/restore paths never pass `savedPlaces`, and none call `selectPlaceIds` at all per survey, so the guard is belt-and-braces.)
  - Call sites pass their created data: `usePinDraft.saveDraft` → `selectPlaceIds([created.id], [created])` (widen the injected dep's type); `handleManualSubmit` → `selectPlaceIds([created.id], [created])`; `handleImport` → `selectPlaceIds(result.places.map(p => p.id), result.places)`.
  - Offer consumption/clearing: `setOffer(null)` at the top of `handleFollowupChip` (above), in the panel's `onSend` wrapper, and in `runPanelCommand`. Also clear on `invalidateAnalysisContext()` (stale offers reference old settings).
  - Assistant `add_place` (bridge path): NO offer — verified structurally (never calls `selectPlaceIds`); add a test pinning it.
- [ ] **Step 4 (audit tests):** in MapWorkspace.test.tsx: (a) pin save → offer text + chips appear, NO `compare.run`/`analyzePlaces` fired; (b) offer chip click → `streamAssistantCommand` with the offered args and the offer row is consumed (followup chips return once a card lands); (c) share-link mount → exactly one auto-run (spy `comparePlaces`/`getNeighborhoodAnalysis` call counts), NO offer; (d) lookup → one auto-run, no offer; (e) import (2 places) → "compare these 2" offer; (f) assistant add_place tool event → no offer.
- [ ] **Step 5:** full suites + tsc + build; commit `feat(rail): deterministic place-added offers with auto-run guard`.

---

### Task 3: Gate + E2E + merge (coordinator)

- [ ] Full gate; E2E: fresh session → onboarding chips (search focus / pin mode / manual modal each work); save a pin → offer appears → chip runs a real analysis (card + badge); share link → auto-run only, no offer; invariant sweep. Fresh-context final review; squash-merge.

## Out of scope
- Notable-data-change proactivity (explicitly deselected in the design phase)
- Sheet snap mechanics (Slice 6); legacy tab deletion (Slice 7)
