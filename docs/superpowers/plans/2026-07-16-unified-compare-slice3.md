# Unified Compare — Slice 3 (Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the review-accumulated polish on the unified Compare surface: the `useAddressList` rename, pending-id invalidation, clipboard feedback, an aria-live completion announcement, ad-hoc map pins with unified row↔map hover linkage, and the pre-load banner-Exit guard — then verify on desktop AND mobile and ship.

**Architecture:** No new modules except the renamed hook file. Ad-hoc pins are synthesized upstream in `MapWorkspace` as `Place`-shaped objects (id = `keyOf(entry)`) appended to the `places` prop — `MapCanvas` is untouched; letters flow through the existing `identityByPlaceId`, now keyed by `savedPlaceId ?? keyOf(entry)`. Hover linkage unifies on that same id everywhere (module cards, and new: ranked rows), with an `entries[index]` fallback so assistant-applied panes (null `runPoints`) keep hover. All items are frontend-only.

**Tech Stack:** React + TypeScript + Vite, Vitest (`--environment jsdom`), `tsc -b` via `npm run lint`. Frontend commands from `frontend/`; git from the worktree root. Baseline: 379 tests / 61 files green, lint clean at `152138a` (merged main).

**Context for line numbers:** all references are to the worktree state at branch point `152138a`. Key files: `frontend/src/components/MapWorkspace.tsx` (549 lines), `frontend/src/components/CompareTab.tsx` (282), `frontend/src/components/CompareRankedList.tsx` (54), `frontend/src/lib/useCompareSet.ts` (to be renamed).

---

## Task 1: Rename `useCompareSet.ts` → `useAddressList.ts`

Pure mechanical rename, compiler-verified. Done first so every later task references the new path.

**Files:**
- Rename: `frontend/src/lib/useCompareSet.ts` → `frontend/src/lib/useAddressList.ts`
- Rename: `frontend/src/lib/useCompareSet.test.ts` → `frontend/src/lib/useAddressList.test.ts`
- Modify (imports only): every file matching `grep -rln "lib/useCompareSet\|\./useCompareSet" frontend/src/`

- [ ] **Step 1: Rename with git mv**

```bash
cd /Users/jscocca/Repos/compcat/.worktrees/unified-compare-surface
git mv frontend/src/lib/useCompareSet.ts frontend/src/lib/useAddressList.ts
git mv frontend/src/lib/useCompareSet.test.ts frontend/src/lib/useAddressList.test.ts
```

- [ ] **Step 2: Rewrite the import paths**

Find all importers: `grep -rln "useCompareSet" frontend/src/`. Expected: `frontend/src/lib/useAddressList.test.ts` (imports `./useCompareSet`), `frontend/src/lib/useCompare.ts`, `frontend/src/components/MapWorkspace.tsx`, `frontend/src/components/CompareTab.tsx`, `frontend/src/components/CompareAddressInput.tsx`, and possibly `frontend/src/components/CompareTab.test.tsx` / `frontend/src/components/MapWorkspace.test.tsx`. In each, replace the module specifier only:
- `"../lib/useCompareSet"` → `"../lib/useAddressList"`
- `"./useCompareSet"` → `"./useAddressList"`

No symbol renames — the file's exports are already address-list-named.

- [ ] **Step 3: Verify zero stragglers and green**

Run: `grep -rn "useCompareSet" frontend/src/` → expect zero hits.
Run: `cd frontend && npx vitest run --environment jsdom 2>&1 | tail -3 && npm run lint`
Expected: 379/379 (61 files — same counts, files renamed), lint clean.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "chore(compare): rename useCompareSet.ts to useAddressList.ts"
```

---

## Task 2: Pending-id resolution invalidates results

The `data.places` effect appends resolved entries without invalidating — the only list-edit path that doesn't. One line + one regression test.

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx:189-196` (the pending-ids effect)
- Test: `frontend/src/components/MapWorkspace.test.tsx`

- [ ] **Step 1: Write the failing test**

**(Amended after a BLOCKED report: both `entriesForIds` callers — `selectPlaceIds` and the assistant selection branch — already invalidate at QUEUE time, so "run, then pin-save" can never leave a stale spine. The reachable gap is queue → a FRESH run completes while the id is still pending → the resolve-append lands under those new results. The test must arrange exactly that.)**

Add to `MapWorkspace.test.tsx` immediately after the existing test named `"drops stale panes when the assistant replaces the selection without new results"`:

```tsx
  it("invalidates results when a queued place id resolves under fresh results", async () => {
    // 1. Seed two saved places; let the greet auto-run complete (spine renders).
    // 2. Pin-save a NEW place ("Pin 9", id "p9"): createPlace resolves, but hold the
    //    summary refresh open — mock getDashboardSummary's next call to a DEFERRED
    //    promise you resolve manually later. The id queues as pending.
    // 3. Click the run CTA ("Compare 2 addresses") and let it complete — a fresh spine
    //    renders while p9 is still pending.
    // 4. Resolve the deferred summary WITH p9's place included. The pending-id effect
    //    appends the entry — and must invalidate the now-stale spine.
    expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument();
    const rows = screen.getByRole("list", { name: /addresses to compare/i });
    expect(await within(rows).findByText("Pin 9")).toBeInTheDocument();
  });
```

Arrangement idioms: reuse the mock choreography of "selects a newly saved pin so analysis can run without manual selection" (pin-draft flow) and "drops stale panes when the assistant replaces the selection without new results" (completed-run arrangement); the deferred summary is a plain manually-resolved promise (`let resolveSummary: (v: DashboardSummaryLike) => void; vi.mocked(getDashboardSummary).mockReturnValueOnce(new Promise((r) => { resolveSummary = r; }))` — adapt naming to the suite's style). Scope the row assertion `within(rows)` — the chip strip also renders the place label once the summary lands.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx --environment jsdom`
Expected: the new test FAILS — `compare-ranked` is still in the document (no invalidation on resolve-append).

- [ ] **Step 3: Implement**

In `frontend/src/components/MapWorkspace.tsx`, the pending-ids effect currently reads:

```tsx
  useEffect(() => {
    if (pendingIdsRef.current.length === 0) return;
    const pending = pendingIdsRef.current;
    pendingIdsRef.current = [];
    const resolved = entriesForIds(pending);
    resolved.forEach((entry) => list.add(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.places]);
```

Change the body so a non-empty append invalidates first:

```tsx
  useEffect(() => {
    if (pendingIdsRef.current.length === 0) return;
    const pending = pendingIdsRef.current;
    pendingIdsRef.current = [];
    const resolved = entriesForIds(pending);
    if (resolved.length > 0) {
      // A late-resolving entry changes the list under existing results.
      invalidateAnalysisContext();
      resolved.forEach((entry) => list.add(entry));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.places]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx --environment jsdom`
Expected: all pass (baseline count +1).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "fix(compare): queued place-id resolution invalidates stale results"
```

**Review amendment (applied post-commit):** the invalidate is gated on `compare.runPoints !== null` — run results are keyed to the list and go stale on a late append, but assistant-applied panes (`runPoints === null`, by-name compares whose created ids resolve via the effect's own refetch) must survive. Locked by an assistant-by-name regression test.

---

## Task 3: Clipboard feedback on Copy link

Failed clipboard writes are currently silent unhandled rejections; successes give no confirmation.

**Files:**
- Modify: `frontend/src/components/CompareTab.tsx` (copy-link block, lines ~239-252)
- Test: `frontend/src/components/CompareTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `CompareTab.test.tsx`, replace the existing test `"copies the share link when results exist"` with these three (keep the same clipboard mocking idiom already used there — `Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })`):

```tsx
  it("copies the share link and confirms with a transient status", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopyLink = vi.fn().mockReturnValue("https://example.test/?view=abc");
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));
    expect(writeText).toHaveBeenCalledWith("https://example.test/?view=abc");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("reports a clipboard failure instead of rejecting silently", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopyLink = vi.fn().mockReturnValue("https://example.test/?view=abc");
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));
    expect(await screen.findByText("Couldn't copy — try again.")).toBeInTheDocument();
  });

  it("copy status region is polite live and empty at rest", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} onCopyLink={() => "u"} />);
    const status = screen.getByTestId("copy-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx --environment jsdom`
Expected: the three new tests FAIL (no status region; unhandled rejection surfaced by vitest on the failure case).

- [ ] **Step 3: Implement**

In `CompareTab.tsx`:

1. Add state + cleanup near the other state hooks (after `editingControls`):

```tsx
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);
  useEffect(() => () => { if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current); }, []);
  function flashCopyState(next: "copied" | "failed") {
    setCopyState(next);
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }
```

2. Replace the copy-link block:

```tsx
          {hasResults && onCopyLink ? (
            <div className="mc-analyze-actions">
              <button
                type="button"
                className="mc-link-copy"
                onClick={async () => {
                  const url = onCopyLink();
                  if (!url) return;
                  try {
                    await navigator.clipboard.writeText(url);
                    flashCopyState("copied");
                  } catch {
                    flashCopyState("failed");
                  }
                }}
              >
                Copy link to this view
              </button>
              <span className="mc-copy-status" data-testid="copy-status" role="status" aria-live="polite">
                {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy — try again." : ""}
              </span>
            </div>
          ) : null}
```

3. Append to `frontend/src/styles/mapWorkspace.css`:

```css
.mc-copy-status{font-size:12px;color:var(--text-dim);margin-top:2px;}
```

- [ ] **Step 4: Run to verify green**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx --environment jsdom && npm run lint`
Expected: all pass (panel suite baseline +2 net), lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CompareTab.tsx frontend/src/components/CompareTab.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(compare): copy-link success and failure feedback"
```

**Review amendments:** the plan originally cited a nonexistent `--dim` token (repo convention is `--text-dim` — the implementer caught and corrected this), and `margin-left` inside the column-flex `.mc-analyze-actions` was swapped for `margin-top:2px` (a left margin only indents there).

---

## Task 4: aria-live completion announcement

Results mount outside any live region; screen-reader users get no completion signal (the skeleton's `aria-live` unmounts with it).

**Files:**
- Modify: `frontend/src/components/CompareTab.tsx`
- Test: `frontend/src/components/CompareTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `CompareTab.test.tsx`:

```tsx
  it("announces completion politely: comparison wording at 2+", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} />);
    const region = screen.getByTestId("run-announcement");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Comparison complete: 2 addresses ranked by reported incident rate.");
  });

  it("announces completion politely: analysis wording at 1", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} />);
    expect(screen.getByTestId("run-announcement")).toHaveTextContent("Analysis complete for 1 address.");
  });

  it("announcement is empty while running and before any run", () => {
    const { rerender } = render(<CompareTab {...base} entries={entriesOf("Pike")} />);
    expect(screen.getByTestId("run-announcement")).toHaveTextContent("");
    rerender(<CompareTab {...base} entries={entriesOf("Pike")} running />);
    expect(screen.getByTestId("run-announcement")).toHaveTextContent("");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx --environment jsdom`
Expected: FAIL — no `run-announcement` test id.

- [ ] **Step 3: Implement**

In `CompareTab.tsx`, directly after the `<div ref={resultsAnchorRef} aria-hidden="true" />` line, add a PERSISTENT visually-hidden live region (it must render in both the running and results branches — that's why it sits outside them):

```tsx
      <p className="mc-sr" data-testid="run-announcement" role="status" aria-live="polite">
        {!running && hasResults
          ? comparison
            ? `Comparison complete: ${runPoints?.length ?? entries.length} addresses ranked by ${noun.singular} rate.`
            : `Analysis complete for ${runPoints?.length ?? entries.length} ${(runPoints?.length ?? entries.length) === 1 ? "address" : "addresses"}.`
          : ""}
      </p>
```

(`mc-sr` is the existing visually-hidden utility class used by the skeleton block.)

- [ ] **Step 4: Verify green + vocabulary sweep**

Run: `cd frontend && npx vitest run src/components/CompareTab.test.tsx --environment jsdom`
Expected: all pass — including the existing banned-vocabulary sweep, which now also covers the announcement text (it renders inside the panel container the sweep reads).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CompareTab.tsx frontend/src/components/CompareTab.test.tsx
git commit -m "feat(compare): polite completion announcement for assistive tech"
```

---

## Task 5: Ad-hoc map pins + unified row↔map hover linkage

The map shows nothing for unsaved addresses, and only expanded module cards hover-link. After this task: every list entry has a lettered pin; hovering a ranked row, a module card, or a chip pulses the right pin; assistant-applied panes keep hover via the entries fallback.

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx` (pin synthesis, identity map, toggle handler)
- Modify: `frontend/src/components/CompareTab.tsx` (hover id unification + row hover map)
- Modify: `frontend/src/components/CompareRankedList.tsx` (row hover events)
- Test: `frontend/src/components/CompareRankedList.test.tsx`, `frontend/src/components/CompareTab.test.tsx`, `frontend/src/components/MapWorkspace.test.tsx`

- [ ] **Step 1: Failing tests — CompareRankedList row hover**

Add to `CompareRankedList.test.tsx` (reuse its existing `rows` fixture):

```tsx
  it("fires onHoverRow with the row's option id on enter and null on leave", () => {
    const onHoverRow = vi.fn();
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} onHoverRow={onHoverRow} />);
    const first = screen.getByTestId("compare-ranked").querySelectorAll(".mc-ranked-row")[0]!;
    fireEvent.mouseEnter(first);
    expect(onHoverRow).toHaveBeenCalledWith(rows[0].optionId);
    fireEvent.mouseLeave(first);
    expect(onHoverRow).toHaveBeenLastCalledWith(null);
  });
```

(Add `fireEvent` and `vi` to that file's imports if absent.)

- [ ] **Step 2: Failing tests — CompareTab hover unification**

Add to `CompareTab.test.tsx`:

```tsx
  it("ranked-row hover reaches onHoverPlace with the entry's hover id (keyOf for ad-hoc)", () => {
    const onHoverPlace = vi.fn();
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} onHoverPlace={onHoverPlace} />);
    const firstRow = screen.getByTestId("compare-ranked").querySelectorAll(".mc-ranked-row")[0]!;
    fireEvent.mouseEnter(firstRow);
    // Rank 1 is Pike (lowest rate); ad-hoc entries hover by coordinate key.
    expect(onHoverPlace).toHaveBeenCalledWith(keyOf(entriesOf("Pike")[0]));
    fireEvent.mouseLeave(firstRow);
    expect(onHoverPlace).toHaveBeenLastCalledWith(null);
  });

  it("module hover falls back to the live entry when runPoints is absent (assistant-applied pane)", () => {
    const onHoverPlace = vi.fn();
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={null} onHoverPlace={onHoverPlace} />);
    fireEvent.mouseEnter(screen.getByLabelText("Context for Pike"));
    expect(onHoverPlace).toHaveBeenCalledWith(keyOf(entriesOf("Pike")[0]));
  });
```

(Import `keyOf` from `../lib/useAddressList` in the test file if absent.)

- [ ] **Step 3: Run to verify both fail**

Run: `cd frontend && npx vitest run src/components/CompareRankedList.test.tsx src/components/CompareTab.test.tsx --environment jsdom`
Expected: new tests FAIL (no `onHoverRow` prop; hover translation returns null for ad-hoc/absent runPoints).

- [ ] **Step 4: Implement — CompareRankedList**

In `CompareRankedList.tsx`, extend the props and the row div:

```tsx
export function CompareRankedList({ rows, noun, radiusM, expansionByOptionId, onHoverRow }: { rows: CompareVerdictRow[]; noun: IncidentNoun; radiusM: number; expansionByOptionId?: Map<string, ReactNode>; onHoverRow?: (optionId: string | null) => void }) {
```

and on the row `<div ...>`:

```tsx
          <div
            className={`mc-ranked-row${row.relationship === "lowest" ? " is-lowest" : ""}`}
            key={row.optionId}
            onMouseEnter={onHoverRow ? () => onHoverRow(row.optionId) : undefined}
            onMouseLeave={onHoverRow ? () => onHoverRow(null) : undefined}
          >
```

- [ ] **Step 5: Implement — CompareTab hover unification**

In `CompareTab.tsx`:

1. Add a hover-id helper above `moduleFor` (uses the same index space as runPoints/entries):

```tsx
  // One hover identity per entry: saved id when it exists, coordinate key otherwise —
  // matching the synthetic pin ids MapWorkspace renders for ad-hoc entries. Falls back
  // to the live entries when runPoints is absent (assistant-applied panes null it).
  function hoverIdFor(index: number): string | null {
    const point = runPoints?.[index] ?? entries[index];
    if (!point) return null;
    return point.savedPlaceId ?? keyOf(point);
  }
```

2. In `moduleFor`, replace the `onHoverPlace` and `coords` lines:

```tsx
    const point = runPoints?.[index] ?? entries[index];
```
(replacing the existing `const point = runPoints?.[index];`), and

```tsx
        onHoverPlace={onHoverPlace ? (id) => onHoverPlace(id ? hoverIdFor(index) : null) : undefined}
```

3. Build the row-hover map next to `expansionByOptionId`:

```tsx
  const hoverIdByOptionId = useMemo(() => {
    if (!comparison) return undefined;
    const map = new Map<string, string | null>();
    comparison.analytical.options.forEach((option, index) => map.set(option.id, hoverIdFor(index)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison, runPoints, entries]);
```

4. Pass row hover through to the ranked list (the `<CompareRankedList ...>` mount):

```tsx
              <CompareRankedList
                rows={verdict.rows}
                noun={noun}
                radiusM={analysis.radiusM}
                expansionByOptionId={expansionByOptionId}
                onHoverRow={onHoverPlace ? (optionId) => onHoverPlace(optionId ? hoverIdByOptionId?.get(optionId) ?? null : null) : undefined}
              />
```

- [ ] **Step 6: Implement — MapWorkspace ad-hoc pins**

In `MapWorkspace.tsx`:

1. Replace the `identityByPlaceId` memo (lines ~99-107) so every entry gets an identity keyed by its hover/pin id:

```tsx
  // One identity source for cards AND pins: index within the list. Saved entries key by
  // place id; ad-hoc entries key by coordinate key — the same synthetic id their map pins
  // and hover events use.
  const identityByPlaceId = useMemo(
    () =>
      new Map<string, PlaceIdentity>(
        list.entries.map((entry, index) => [entry.savedPlaceId ?? keyOf(entry), placeIdentity(index)] as const),
      ),
    [list.entries],
  );
```

2. After the `savedIdSet` memo, add the synthesized pins:

```tsx
  // Ad-hoc entries get map pins too: Place-shaped synthetics keyed by coordinate key.
  // They render as "selected" pins (letter + label tag); rings/badges need persisted
  // summaries, which only saved places have.
  const adhocPlaces = useMemo(
    () =>
      list.entries
        .filter((entry) => !entry.savedPlaceId)
        .map((entry) => ({
          id: keyOf(entry),
          display_label: entry.label,
          latitude: entry.latitude,
          longitude: entry.longitude,
          visit_count: 0,
          total_dwell_minutes: null,
          inferred_place_type: "adhoc_entry",
          sensitivity_class: "normal",
        })),
    [list.entries],
  );
  const mapPlaces = useMemo(() => [...data.places, ...adhocPlaces], [data.places, adhocPlaces]);
  const pinIdSet = useMemo(
    () => new Set([...savedIdSet, ...adhocPlaces.map((p) => p.id)]),
    [savedIdSet, adhocPlaces],
  );
```

3. Update the `<MapCanvas>` mount: `places={mapPlaces}` and `selectedIds={pinIdSet}` (leave every other prop unchanged — `ManagePlacesModal` keeps `selectedIds={savedIdSet}`).

4. Extend `handleToggleSelect` to handle synthetic ids (clicking an ad-hoc pin removes its entry):

```tsx
  function handleToggleSelect(id: string) {
    invalidateAnalysisContext();
    pinDraft.setDraft(null);
    setSharedBanner(false);
    const place = data.places.find((p) => p.id === id);
    if (place) {
      list.toggleSaved(place);
      return;
    }
    const adhocIndex = list.entries.findIndex((e) => !e.savedPlaceId && keyOf(e) === id);
    if (adhocIndex >= 0) list.removeAt(adhocIndex);
  }
```

- [ ] **Step 7: Failing-then-passing test — MapWorkspace pin synthesis**

The `MapCanvas` mock in `MapWorkspace.test.tsx` renders nothing; extend the mock to capture props (mirroring the existing `flyToCaptures` pattern — top of file):

```tsx
const canvasCaptures: { places: unknown[]; selectedIds: Set<string> }[] = [];
```

and inside the mock component body, push `{ places: props.places, selectedIds: props.selectedIds }` each render (add `canvasCaptures.length = 0;` to `afterEach` alongside `flyToCaptures`). Then add this test after the delete-removes-row test:

```tsx
  it("synthesizes lettered pins for ad-hoc entries", async () => {
    // Arrange a session with one saved place selected, then add an ad-hoc address via
    // the compare input (copy the add-address idiom from the 'address rows' tests).
    // After the add, the last canvas capture must contain a synthetic place whose id is
    // the entry's coordinate key and which is present in selectedIds:
    const last = canvasCaptures[canvasCaptures.length - 1]!;
    const synthetic = (last.places as { id: string; inferred_place_type: string }[]).find((p) => p.inferred_place_type === "adhoc_entry");
    expect(synthetic).toBeDefined();
    expect(last.selectedIds.has(synthetic!.id)).toBe(true);
  });
```

Write the arrangement following the existing add-address test's idiom (type into "Add an address to compare", geocoding mock resolves, click Add).

- [ ] **Step 8: Run the three suites**

Run: `cd frontend && npx vitest run src/components/CompareRankedList.test.tsx src/components/CompareTab.test.tsx src/components/MapWorkspace.test.tsx --environment jsdom && npm run lint`
Expected: all pass; lint clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/CompareTab.tsx frontend/src/components/CompareRankedList.tsx frontend/src/components/CompareRankedList.test.tsx frontend/src/components/CompareTab.test.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(compare): lettered map pins for ad-hoc entries; row-level hover linkage"
```

---

## Task 6: Pre-load banner-Exit guard

Exiting a shared view before the initial data load rebuilds the list from a not-yet-restored (empty) selection. Guard: before `restored`, Exit only dismisses the banner and keeps the shared list.

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx` (banner Exit handler)
- Test: `frontend/src/components/MapWorkspace.test.tsx`

- [ ] **Step 1: Write the failing test**

Add after the existing banner-Exit restore test (locate via grep for "banner"), following its share-link arrangement but making the summary fetch hang:

```tsx
  it("banner Exit before the data load keeps the shared list instead of clearing it", async () => {
    // Arrange: mount with a 2-point ?view= link, but getDashboardSummary returns a
    // promise that never resolves during the test (vi.mocked(...).mockReturnValue(new Promise(() => {}))).
    // Act: click the banner's Exit button as soon as it renders.
    // Assert: both shared address rows are still listed and no crash occurred:
    expect(screen.getByText("Downtown test point")).toBeInTheDocument();
    expect(screen.getByText("North test point")).toBeInTheDocument();
    expect(screen.queryByText(/shared view/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx --environment jsdom`
Expected: FAIL — the rows disappear (list rebuilt from the empty pre-restore selection).

- [ ] **Step 3: Implement**

In the banner Exit `onClick` (MapWorkspace.tsx ~lines 429-434), guard on `restored`:

```tsx
              onClick={() => {
                setSharedBanner(false);
                // Before the restore lands there is no saved selection to rebuild from —
                // keep the shared list; the user can edit it from here.
                if (!restored) return;
                invalidateAnalysisContext();
                list.replaceAll(entriesFromPlaces(data.places.filter((p) => selectedIds.has(p.id))));
                setPendingAutoRun(true);
              }}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx --environment jsdom`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "fix(compare): banner Exit before the restore keeps the shared list"
```

---

## Task 7: Docs, gate, desktop + mobile e2e, PR

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Tick slice 3 in the roadmap**

Replace the slice-3 line (the one beginning `- [ ] **Slice 3 — polish**`) with:

```markdown
- [x] **Slice 3 — polish** — shipped: `useAddressList.ts` rename, queued-id invalidation,
  copy-link success/failure feedback, polite completion announcement, lettered map pins
  for ad-hoc entries with row↔map hover linkage (assistant-pane fallback included), and
  the pre-load banner-Exit guard. Mobile pass verified. Plan:
  `docs/superpowers/plans/2026-07-16-unified-compare-slice3.md`.
- [ ] **Compare backlog (optional):** pin-to-compare side-by-side columns (Shape A for
  2–3 candidates), progressive spine-first rendering.
```

- [ ] **Step 2: Full gate**

Run: `cd /Users/jscocca/Repos/compcat/.worktrees/unified-compare-surface && make test-all`
Expected: pytest green, ruff clean, frontend green (Task counts: 379 baseline + new tests), build succeeds. STOP on any failure.

- [ ] **Step 3: End-to-end verification (desktop + mobile)**

Follow `/Users/jscocca/Repos/compcat/.claude/skills/verify/SKILL.md` (launch config `compcat-worktree-verify`, port 8017; DB already seeded). Drive with Browser pane tools:

1. Two-point tab-free share link (downtown 47.6005,-122.3315 + north 47.6595,-122.3125; 2022-01-01→2025-10-31): spine renders; **both pins on the map with A/B letters** (ad-hoc synthetics — this is the new behavior); hovering ranked row 1 pulses the matching pin (`is-pulsing` class via JS check on `.mc-pin-icon`).
2. Copy link → "Copied" status appears next to the button.
3. Save row 2 → row flips "Saved"; its pin persists (now saved, still lettered).
4. `resize_window` to the mobile preset: bottom sheet renders; run again; controls collapse to the summary+Adjust row; expand a Full context row; confirm usable layout (screenshot).
5. Banned-vocabulary sweep on the live DOM (only "risk" = the fixed caveat).
6. Screenshots at each step; stop the server when done.

FAIL → STOP before the PR.

- [ ] **Step 4: Commit docs, push, open PR**

```bash
cd /Users/jscocca/Repos/compcat/.worktrees/unified-compare-surface
git add docs/ROADMAP.md
git commit -m "docs(roadmap): tick unified-Compare slice 3"
git push -u origin jcscocca/claude/unified-compare-slice3
gh pr create --title "feat(compare): slice 3 polish — ad-hoc pins, hover linkage, a11y + feedback" --body "$(cat <<'EOF'
Slice 3 (final) of the unified Compare surface (spec: docs/superpowers/specs/2026-07-16-unified-compare-surface-design.md; plan: docs/superpowers/plans/2026-07-16-unified-compare-slice3.md).

- Every list entry now has a lettered map pin (ad-hoc entries render as synthetics keyed by coordinate); hovering a ranked row, module card, or chip pulses the matching pin, including assistant-applied panes (entries fallback).
- Copy link confirms or reports failure; run completion is announced politely for assistive tech.
- Queued place-id resolution invalidates stale results; banner Exit before the initial load keeps the shared list; useCompareSet.ts renamed to useAddressList.ts.

make test-all green; desktop + mobile end-to-end verified per the project verify skill.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do NOT merge the PR.

---

## Out of scope (do not do here)

- Pin-to-compare side-by-side columns; progressive spine-first rendering (backlog).
- Backend option-ordering hardening (separate chipped task).
- Any backend/`app/` change.
- Marker clustering or ring rendering for ad-hoc entries.
