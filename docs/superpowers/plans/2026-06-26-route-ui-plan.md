# Route UI + Public Route Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Routes drawer tab that compares route alternatives between known places by reported-incident corridor context, drawn on the map, backed by new public route endpoints.

**Architecture:** Reuse the route engine unchanged. Add public `/routes` endpoints wrapping `route_service`; a `RoutesTab` rendering the engine's comparison payload; route polylines on `MapCanvas`. Mock-only routing (6 known places); generalizes when OTP is live.

**Tech Stack:** FastAPI, SQLAlchemy, pytest, ruff; React, TypeScript, react-leaflet, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-route-ui-design.md`
**Worktree/branch:** `.worktrees/route-ui` on `claude/route-ui`. Run commands from the worktree root.

---

## File Structure

- Create `app/api/routes_public_routes.py` — public `POST /routes/alternatives`, `GET /routes/requests/{id}/comparison`.
- Modify `app/main.py` (register), `CLAUDE.md` (public tier), `tests/test_internal_surface.py` (allowlist).
- Create `tests/test_routes_public_api.py`.
- Modify `frontend/src/types.ts` (TabKey + route types), `frontend/src/api/client.ts` (`createRouteAlternatives`).
- Create `frontend/src/lib/routeGeometry.ts` (+ test), `frontend/src/components/RoutesTab.tsx` (+ test).
- Modify `frontend/src/components/MapCanvas.tsx` (Polyline), `BottomSheet.tsx` (tab), `MapWorkspace.tsx` (wiring).

---

## Task 0: Workspace setup

- [ ] **Step 1: Symlinks + excludes**

```bash
cd .worktrees/route-ui
ln -sfn "/Users/jscocca/Repos/Crime Commute Safety Tool/.venv" .venv
ln -sfn "/Users/jscocca/Repos/Crime Commute Safety Tool/frontend/node_modules" frontend/node_modules
printf '%s\n' '.venv' 'frontend/node_modules' >> "$(git rev-parse --git-path info/exclude)"
```

- [ ] **Step 2: Baseline green**

Run: `.venv/bin/python -m pytest tests/test_route_alternatives_api.py tests/test_internal_surface.py -q`
Expected: PASS.

---

## Task 1: Public `/routes` endpoints

**Files:** Create `app/api/routes_public_routes.py`; Modify `app/main.py`, `CLAUDE.md`, `tests/test_internal_surface.py`; Test `tests/test_routes_public_api.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_routes_public_api.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path):
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'm.sqlite3'}"))


def _route_body(origin: str, destination: str) -> dict:
    return {
        "origin_label": origin,
        "destination_label": destination,
        "mode": "transit",
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [500],
    }


def test_public_route_alternatives_returns_ranked_comparison(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "Downtown Seattle"))
    assert response.status_code == 200
    body = response.json()
    assert len(body["alternatives"]) >= 2
    assert body["alternatives"][0]["rank"] == 1
    assert body["statistical_comparison"] is not None
    assert "user_id_hash" not in body["request"]


def test_public_route_alternatives_requires_session(tmp_path):
    client = _client(tmp_path)
    response = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "Downtown Seattle"))
    assert response.status_code == 401


def test_public_route_single_alternative_has_no_comparison(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "University District"))
    assert response.status_code == 200
    body = response.json()
    assert len(body["alternatives"]) == 1
    assert body["statistical_comparison"] is None


def test_public_route_comparison_roundtrip(tmp_path):
    client = _client(tmp_path)
    client.post("/sessions")
    created = client.post("/routes/alternatives", json=_route_body("Capitol Hill", "Downtown Seattle")).json()
    request_id = created["request"]["id"]
    fetched = client.get(f"/routes/requests/{request_id}/comparison")
    assert fetched.status_code == 200
    assert fetched.json()["request"]["id"] == request_id
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_routes_public_api.py -q`
Expected: FAIL — no `/routes/alternatives` route (404/405).

- [ ] **Step 3: Create the public router**

Create `app/api/routes_public_routes.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import required_public_user_hash
from app.db import get_session
from app.routing.place_resolver import UnknownRoutePlaceError
from app.routing.providers import RoutingProviderError, UnsupportedRoutingProviderError
from app.routing.schemas import RouteRequestCreate
from app.services.route_service import create_route_alternatives, get_route_comparison

router = APIRouter()


@router.post("/routes/alternatives")
def alternatives(
    request: RouteRequestCreate,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return create_route_alternatives(session, request, user_id_hash)
    except (UnknownRoutePlaceError, UnsupportedRoutingProviderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RoutingProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/routes/requests/{request_id}/comparison")
def comparison(
    request_id: str,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    payload = get_route_comparison(session, request_id, user_id_hash)
    if payload is None:
        raise HTTPException(status_code=404, detail="Route request not found")
    return payload
```

- [ ] **Step 4: Register the router**

In `app/main.py`, add `from app.api.routes_public_routes import router as public_routes_router` near the other public-router imports, and `app.include_router(public_routes_router)` next to `app.include_router(public_places_router)`.

- [ ] **Step 5: Update the internal-surface guard (route surface is now public)**

In `tests/test_internal_surface.py`: remove `"/routes/"` from `FORBIDDEN_PREFIXES` (keep `/internal/`, `/analysis/`, `/imports`, `/crime/`), and add the two public route paths to `PUBLIC_PATHS`:

```python
    "/routes/alternatives",
    "/routes/requests/{request_id}/comparison",
```

(The `/internal/routes/*` endpoints stay forbidden via the `/internal/` prefix; the corridor statistical comparison is bundled in the `/routes` payload, so no public `/analysis/*` path is added.)

- [ ] **Step 6: Update CLAUDE.md public tier**

In `CLAUDE.md`, add `/routes*` (route comparison) to the **Public** tier bullet list.

- [ ] **Step 7: Run backend tests + ruff**

Run: `.venv/bin/python -m pytest tests/test_routes_public_api.py tests/test_internal_surface.py tests/test_public_session_required.py -q && .venv/bin/python -m ruff check app/api/routes_public_routes.py`
Expected: PASS + clean.

- [ ] **Step 8: Commit**

```bash
git add app/api/routes_public_routes.py app/main.py CLAUDE.md tests/test_internal_surface.py tests/test_routes_public_api.py
git commit -m "feat: public route-alternatives endpoints"
```

---

## Task 2: Frontend types + client + geometry helper

**Files:** Modify `frontend/src/types.ts`, `frontend/src/api/client.ts`; Create `frontend/src/lib/routeGeometry.ts` + test

- [ ] **Step 1: Write the geometry-parse failing test**

Create `frontend/src/lib/routeGeometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseRouteGeometry } from "./routeGeometry";

describe("parseRouteGeometry", () => {
  it("parses a lat,lon;lat,lon string into points", () => {
    expect(parseRouteGeometry("47.61,-122.33;47.60,-122.34")).toEqual([
      [47.61, -122.33],
      [47.6, -122.34],
    ]);
  });

  it("returns [] for empty or malformed input", () => {
    expect(parseRouteGeometry(null)).toEqual([]);
    expect(parseRouteGeometry("")).toEqual([]);
    expect(parseRouteGeometry("not-a-point")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/routeGeometry.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/routeGeometry.ts`:

```ts
export function parseRouteGeometry(geometry: string | null | undefined): [number, number][] {
  if (!geometry) return [];
  const points: [number, number][] = [];
  for (const raw of geometry.split(";")) {
    const [latText, lonText] = raw.split(",");
    const lat = Number(latText);
    const lon = Number(lonText);
    if (Number.isFinite(lat) && Number.isFinite(lon) && latText !== undefined && lonText !== undefined) {
      points.push([lat, lon]);
    }
  }
  return points;
}
```

- [ ] **Step 4: Add types**

In `frontend/src/types.ts`, change `TabKey` and add the route types:

```ts
export type TabKey = "places" | "analyze" | "compare" | "routes" | "export";

export type RouteAlternative = {
  id: string;
  route_label: string;
  rank: number;
  duration_minutes: number | null;
  distance_m: number | null;
  transfer_count: number;
  walking_distance_m: number | null;
  mode_mix: string;
  summary_geometry: string | null;
};

export type RouteContextSummaryItem = {
  route_alternative_id: string;
  radius_m: number;
  incident_count: number;
  nearest_incident_m: number | null;
  offense_category: string | null;
  offense_subcategory: string | null;
};

export type RouteComparison = {
  request: { id: string; origin: { label: string }; destination: { label: string }; mode: string };
  alternatives: RouteAlternative[];
  context_summaries: RouteContextSummaryItem[];
  statistical_comparison: {
    overview: {
      decision_class: string;
      recommendation_option_id: string | null;
      recommendation_label: string | null;
      summary_text: string;
      caveat_text: string;
    };
  } | null;
};

export type RouteLine = { id: string; points: [number, number][]; recommended: boolean };
```

- [ ] **Step 5: Add the client call**

In `frontend/src/api/client.ts`, add a `RouteComparison` import to the type import block and:

```ts
export function createRouteAlternatives(payload: {
  origin_label: string;
  destination_label: string;
  mode: string;
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
}): Promise<RouteComparison> {
  return request("/routes/alternatives", { method: "POST", body: JSON.stringify(payload) });
}
```

- [ ] **Step 6: Run + commit**

Run: `cd frontend && npx vitest run src/lib/routeGeometry.test.ts && npm run build`
Expected: PASS + build ok.

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/lib/routeGeometry.ts frontend/src/lib/routeGeometry.test.ts
git commit -m "feat: route comparison types, client call, geometry parser"
```

---

## Task 3: RoutesTab component

**Files:** Create `frontend/src/components/RoutesTab.tsx` + test

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/RoutesTab.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutesTab } from "./RoutesTab";
import type { AnalysisSettings, RouteComparison } from "../types";

const analysis: AnalysisSettings = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 500, offenseCategory: "" };

const twoAlt: RouteComparison = {
  request: { id: "r1", origin: { label: "Capitol Hill" }, destination: { label: "Downtown Seattle" }, mode: "transit" },
  alternatives: [
    { id: "a1", route_label: "Link light rail via Westlake", rank: 1, duration_minutes: 14, distance_m: 2100, transfer_count: 0, walking_distance_m: 450, mode_mix: "walk,transit", summary_geometry: "47.61,-122.33;47.60,-122.34" },
    { id: "a2", route_label: "Pine Street bus", rank: 2, duration_minutes: 18, distance_m: 2200, transfer_count: 0, walking_distance_m: 500, mode_mix: "walk,bus", summary_geometry: "47.62,-122.32;47.60,-122.34" },
  ],
  context_summaries: [
    { route_alternative_id: "a1", radius_m: 500, incident_count: 4, nearest_incident_m: 40, offense_category: "PROPERTY", offense_subcategory: "THEFT" },
    { route_alternative_id: "a2", radius_m: 500, incident_count: 9, nearest_incident_m: 12, offense_category: "PROPERTY", offense_subcategory: "BURGLARY" },
  ],
  statistical_comparison: {
    overview: { decision_class: "statistically_lower", recommendation_option_id: "a1", recommendation_label: "Link light rail via Westlake", summary_text: "Link light rail via Westlake has a statistically lower reported-incident rate for the selected corridor.", caveat_text: "This describes reported incidents, not causation or personal outcomes." },
  },
};

const oneAlt: RouteComparison = {
  ...twoAlt,
  alternatives: [twoAlt.alternatives[0]],
  statistical_comparison: null,
};

afterEach(cleanup);

describe("RoutesTab", () => {
  it("renders the verdict and a block per alternative", () => {
    render(<RoutesTab analysis={analysis} running={false} result={twoAlt} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower reported-incident rate/i)).toBeInTheDocument();
    expect(screen.getByText("Link light rail via Westlake")).toBeInTheDocument();
    expect(screen.getByText("Pine Street bus")).toBeInTheDocument();
  });

  it("omits the verdict for a single route", () => {
    render(<RoutesTab analysis={analysis} running={false} result={oneAlt} onRun={vi.fn()} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("runs with the selected origin, destination, and mode", () => {
    const onRun = vi.fn();
    render(<RoutesTab analysis={analysis} running={false} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /compare routes/i }));
    expect(onRun).toHaveBeenCalledWith("Capitol Hill", "Downtown Seattle", "transit");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/RoutesTab.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement RoutesTab**

Create `frontend/src/components/RoutesTab.tsx`:

```tsx
import { useState } from "react";
import type { AnalysisSettings, RouteComparison } from "../types";

const PLACES = ["Capitol Hill", "Downtown Seattle", "Westlake Station", "Rainier Valley", "Ballard", "University District"];
const MODES: { value: string; label: string }[] = [
  { value: "transit", label: "Transit" },
  { value: "walk", label: "Walk" },
  { value: "bike", label: "Bike" },
  { value: "drive", label: "Drive" },
];

type Props = {
  analysis: AnalysisSettings;
  running: boolean;
  result?: RouteComparison | null;
  error?: string;
  onRun: (origin: string, destination: string, mode: string) => void;
};

function corridorContext(result: RouteComparison, alternativeId: string, radiusM: number) {
  const rows = result.context_summaries.filter(
    (s) => s.route_alternative_id === alternativeId && s.radius_m === radiusM,
  );
  const count = rows.reduce((sum, row) => sum + row.incident_count, 0);
  const nearestValues = rows.map((row) => row.nearest_incident_m).filter((v): v is number => v != null);
  const nearest = nearestValues.length ? Math.min(...nearestValues) : null;
  const types = [...new Set(rows.map((row) => row.offense_subcategory || row.offense_category).filter(Boolean))].slice(0, 3);
  return { count, nearest, types };
}

export function RoutesTab({ analysis, running, result, error, onRun }: Props) {
  const [origin, setOrigin] = useState("Capitol Hill");
  const [destination, setDestination] = useState("Downtown Seattle");
  const [mode, setMode] = useState("transit");
  const recommendedId = result?.statistical_comparison?.overview.recommendation_option_id ?? null;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Routes">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="route-origin">From</label>
          <select id="route-origin" className="mc-inp" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label htmlFor="route-destination">To</label>
          <select id="route-destination" className="mc-inp" value={destination} onChange={(e) => setDestination(e.target.value)}>
            {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label id="route-mode-label">Mode</label>
          <div className="mc-chips" role="group" aria-labelledby="route-mode-label">
            {MODES.map((m) => (
              <button key={m.value} type="button" className={`mc-chip${mode === m.value ? " on" : ""}`} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="mc-querybar-run">
          <button type="button" className="mc-cta" disabled={running} onClick={() => onRun(origin, destination, mode)}>
            {running ? "Routing…" : "Compare routes"}
          </button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {result ? (
        <>
          {result.statistical_comparison ? (
            <section className="mc-verdict tone-muted" aria-label="Route comparison verdict">
              <p className="mc-verdict-label">{result.statistical_comparison.overview.summary_text}</p>
              <p className="mc-verdict-sub">{result.statistical_comparison.overview.caveat_text}</p>
            </section>
          ) : (
            <p className="mc-empty-list">One route option — nothing to compare. Reported-incident context for the corridor is below.</p>
          )}

          {result.alternatives.map((alt) => {
            const ctx = corridorContext(result, alt.id, analysis.radiusM);
            return (
              <section key={alt.id} className={`mc-verdict${alt.id === recommendedId ? " tone-ok" : ""}`} aria-label={`Route ${alt.route_label}`}>
                <div className="mc-verdict-head">
                  <span className="mc-verdict-label">{alt.route_label}</span>
                  {alt.id === recommendedId ? <span className="cnt">recommended</span> : null}
                </div>
                <p className="mc-verdict-sub">
                  {alt.duration_minutes != null ? `${Math.round(alt.duration_minutes)} min` : "—"} · {alt.transfer_count} transfer{alt.transfer_count === 1 ? "" : "s"} · {alt.mode_mix}
                  {alt.walking_distance_m != null ? ` · ${Math.round(alt.walking_distance_m)} m walk` : ""}
                </p>
                <p className="mc-verdict-sub">
                  Corridor (≤{analysis.radiusM} m): {ctx.count} reported incident{ctx.count === 1 ? "" : "s"}
                  {ctx.nearest != null ? ` · nearest ${Math.round(ctx.nearest)} m` : ""}
                  {ctx.types.length ? ` · ${ctx.types.join(", ")}` : ""}
                </p>
              </section>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run + commit**

Run: `cd frontend && npx vitest run src/components/RoutesTab.test.tsx`
Expected: PASS.

```bash
git add frontend/src/components/RoutesTab.tsx frontend/src/components/RoutesTab.test.tsx
git commit -m "feat: RoutesTab renders corridor comparison"
```

---

## Task 4: Route polylines on the map

**Files:** Modify `frontend/src/components/MapCanvas.tsx`

- [ ] **Step 1: Add the `routeLines` prop + Polyline rendering**

In `frontend/src/components/MapCanvas.tsx`:
1. Add `Polyline` to the react-leaflet import: `import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";`
2. Ensure `useEffect` is imported from react (add it if absent).
3. Import the type: `import type { ..., RouteLine } from "../types";` (add `RouteLine` to the existing types import).
4. Add `routeLines?: RouteLine[];` to `Props` and destructure it in the component signature.
5. Add a bounds-fitter component near the other map helpers (e.g. after `FlyTo`):

```tsx
function FitRouteBounds({ lines }: { lines: RouteLine[] }) {
  const map = useMap();
  useEffect(() => {
    const points = lines.flatMap((line) => line.points);
    if (points.length >= 2) {
      map.fitBounds(points as [number, number][], { padding: [40, 40] });
    }
  }, [lines, map]);
  return null;
}
```

6. Inside `<MapContainer>` (after the `places.map(...)` block), render the lines:

```tsx
      {routeLines?.map((line) => (
        <Polyline
          key={line.id}
          positions={line.points}
          pathOptions={{
            color: line.recommended ? "#CD6A45" : "#6b7280",
            weight: line.recommended ? 5 : 3,
            opacity: line.recommended ? 0.9 : 0.5,
          }}
        />
      ))}
      {routeLines && routeLines.length > 0 ? <FitRouteBounds lines={routeLines} /> : null}
```

- [ ] **Step 2: Build + existing map tests**

Run: `cd frontend && npx vitest run src/components/MapCanvas.test.tsx && npm run build`
Expected: PASS + build ok (the new prop is optional, so existing `MapCanvas` usage is unaffected).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MapCanvas.tsx
git commit -m "feat: draw route alternatives as map polylines"
```

---

## Task 5: Wire the Routes tab into the workspace

**Files:** Modify `frontend/src/components/BottomSheet.tsx`, `frontend/src/components/MapWorkspace.tsx`

- [ ] **Step 1: Add the tab to the tab bar**

In `frontend/src/components/BottomSheet.tsx`, add a `routes` entry to the `TABS` array (after the `compare` entry) with a route-style icon:

```tsx
  {
    key: "routes",
    label: "Routes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M6 8.5v4a3 3 0 0 0 3 3h3M18 15.5v-4a3 3 0 0 0-3-3h-3" />
      </svg>
    ),
  },
```

- [ ] **Step 2: Wire MapWorkspace**

In `frontend/src/components/MapWorkspace.tsx`:
1. Add to the client import: `createRouteAlternatives`.
2. Add to the types import: `RouteComparison`, `RouteLine`.
3. Import the component: `import { RoutesTab } from "./RoutesTab";`
4. Add state near the other result state:

```tsx
  const [routeComparison, setRouteComparison] = useState<RouteComparison | null>(null);
  const [routeRunning, setRouteRunning] = useState(false);
  const [routeError, setRouteError] = useState<string>("");
```

5. Add a handler near the other `handle*` functions:

```tsx
  const handleRunRoute = async (origin: string, destination: string, mode: string) => {
    setRouteRunning(true);
    setRouteError("");
    try {
      const result = await createRouteAlternatives({
        origin_label: origin,
        destination_label: destination,
        mode,
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radii_m: [analysis.radiusM],
      });
      setRouteComparison(result);
    } catch (caught) {
      setRouteError(caught instanceof Error ? caught.message : "Unable to compare routes.");
    } finally {
      setRouteRunning(false);
    }
  };
```

6. Derive route lines (near the other `useMemo`s or inline before the return):

```tsx
  const routeLines: RouteLine[] = useMemo(() => {
    if (!routeComparison) return [];
    const recommendedId = routeComparison.statistical_comparison?.overview.recommendation_option_id ?? null;
    return routeComparison.alternatives
      .map((alt) => ({ id: alt.id, points: parseRouteGeometry(alt.summary_geometry), recommended: alt.id === recommendedId }))
      .filter((line) => line.points.length >= 2);
  }, [routeComparison]);
```

Add `import { parseRouteGeometry } from "../lib/routeGeometry";`.

7. Pass `routeLines` to `<MapCanvas .../>` (add the prop), and render the tab alongside the others:

```tsx
          {activeTab === "routes" ? (
            <RoutesTab analysis={analysis} running={routeRunning} result={routeComparison} error={routeError} onRun={handleRunRoute} />
          ) : null}
```

- [ ] **Step 3: Frontend suite + build**

Run: `cd frontend && npm test && npm run build`
Expected: PASS + build ok. If `MapWorkspace.test.tsx` / `App.test.tsx` mock `../api/client` and now error, add `createRouteAlternatives: vi.fn()` to those mock factories (the Routes tab is not active on mount, so no resolve value is required). If a tab-list/`BottomSheet` test enumerates tabs, add `routes`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BottomSheet.tsx frontend/src/components/MapWorkspace.tsx
git commit -m "feat: add Routes tab to the map workspace"
```

(If the test mocks needed updating in Step 3, add those files to the commit.)

---

## Task 6: Full verification gate

- [ ] **Step 1:** Run `make test-all`. Expected: pytest, ruff, frontend test, build all pass.
- [ ] **Step 2:** Fix any stragglers; re-run until green.
- [ ] **Step 3:** `git status --short --branch` — only intended files changed; `.venv`/`frontend/node_modules` excluded; `app/static/dashboard/` ignored.

---

## Self-Review

- **Spec coverage:** public endpoints + surface/CLAUDE updates (Task 1); types/client/geometry (Task 2); RoutesTab verdict + per-alternative corridor context (Task 3); map polylines recommended-highlighted (Task 4); tab wiring + run handler + route lines (Task 5); gate (Task 6). Covered.
- **Placeholders:** none — every code step is complete; the conditional test-mock update (Task 5 Step 3) names the exact files and what to add.
- **Type/name consistency:** `RouteComparison` / `RouteAlternative` / `RouteContextSummaryItem` / `RouteLine` defined in Task 2 and used identically in Tasks 3/5; `createRouteAlternatives` payload shape matches `RouteRequestCreate`; `parseRouteGeometry` defined in Task 2 and consumed in Task 5; `routeLines` prop matches between Task 4 (MapCanvas) and Task 5 (MapWorkspace); `recommendation_option_id` drives the recommended highlight in both RoutesTab and the map lines.
