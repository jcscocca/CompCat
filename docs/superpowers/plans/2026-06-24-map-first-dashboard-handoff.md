# Map-First Dashboard Redesign — Codex Handoff

Paste the prompt below to the implementing agent (Codex). Branch: `codex/public-dashboard-launch`.

---

You are implementing a frontend redesign in this repo (branch: `codex/public-dashboard-launch`). Three committed documents define the work — read all three before writing any code:

1. **PLAN (your task list):** `docs/superpowers/plans/2026-06-24-map-first-dashboard-redesign.md`
2. **SPEC (requirements + Visual Design tokens):** `docs/superpowers/specs/2026-06-24-map-first-dashboard-redesign-design.md`
3. **VISUAL TARGET (open in a browser):** `docs/superpowers/specs/2026-06-24-map-first-dashboard-mockup.html`

## Goal

Replace the form-and-table public dashboard with a map-first workspace: a full-bleed Leaflet map for dropping/searching place pins, plus a graphite tabbed bottom sheet (Places / Analyze / Compare / Export). Match the mockup.

## How to work

- Execute the plan's tasks in order, Task 1 → Task 19. The plan is the source of truth.
- For each task, follow its steps EXACTLY: write the failing test, run it and confirm it fails, implement, run it and confirm it passes, then commit with the message given in the task.
- Run all commands from the `frontend/` directory. Do not skip the "run the test" steps; show output.
- Use the complete code blocks in the plan verbatim — they are written against the real interfaces in `src/api/client.ts`, `src/types.ts`, and the existing Vitest/RTL test conventions.

## Hard rules

- Match the mockup's LOOK (palette, fonts, marker states, panel chrome), but build the map with a real Leaflet `TileLayer` (Carto Positron). NEVER render the mockup's SVG as the app's map.
- Radius is a segmented control bound to `summary.analysis.available_radii_m`; categories are the real backend values (`""` / `PROPERTY` / `PERSON` / `SOCIETY`). Do not reproduce the mock's slider or its sample category labels.
- Two assumptions are flagged in the plan (Tasks 6 and 9): `crime_summaries[].place_cluster_id === Place.id`, and the "low data" predicate. Verify both against a real `/dashboard/summary` response. If wrong, fix the single isolated spot and note it — do not let every marker silently fall back to "low data".
- Start from a clean working tree. `src/lib/analysisDefaults.ts` is currently untracked — `git add` it with the first task that imports it. Leave unrelated working-tree changes (`README.md`, `AnalysisControls.*`, `App.test.tsx`) alone unless a task explicitly modifies them.

## Done = Task 19 gates pass

- `npm test` (all pass), `npm run lint` (clean), `npm run build` (succeeds)
- Manual check via `npm run dev`: drop a pin by clicking the map; search an address; run analysis (clay rings + count badges appear); compare two places (revised caveat shows); export link works; tabs are keyboard-operable.

If any step in the plan contradicts the actual codebase or backend, STOP and report the conflict instead of guessing.
