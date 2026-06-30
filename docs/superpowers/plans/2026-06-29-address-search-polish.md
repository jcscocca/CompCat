# Address-Search Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the shared geocode search box (Places + Routes) with debounced type-ahead, stale-request abort, first-class `empty`/`error` states with shared copy, a client-side Seattle-bbox guard, and a recent-places history backed by localStorage.

**Architecture:** A new `searchHistory.ts` module (mirrors `drawerStorage.ts`) holds the localStorage layer; `geocoding.ts` gains a pure `withinSeattleBbox` filter at the provider boundary; `useAddressSearch.ts` is enhanced with debounce/abort, the `empty` status, shared copy constants, and `recent`/`rememberPlace` surface; `PlaceSearch.tsx` and `RoutesTab.tsx` each adopt the new hook surface and render a recent-places list on focus-while-empty. No backend changes — the region-lock is already correct in `app/config.py`.

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react, jsdom, CSS custom properties (existing `mc-` design system in `frontend/src/styles/mapWorkspace.css`).

---

## Task 1: `searchHistory.ts` (new) + test

**Files:**
- Create: `frontend/src/lib/searchHistory.ts`
- Create: `frontend/src/lib/searchHistory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/searchHistory.test.ts`:

```typescript
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { addRecentPlace, loadRecentPlaces } from "./searchHistory";
import type { GeocodeResult } from "../types";

const pike: GeocodeResult = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
const capitol: GeocodeResult = { label: "Capitol Hill, Seattle", latitude: 47.6253, longitude: -122.3222, source: "nominatim" };
const fremont: GeocodeResult = { label: "Fremont, Seattle", latitude: 47.6518, longitude: -122.3500, source: "nominatim" };
const belltown: GeocodeResult = { label: "Belltown, Seattle", latitude: 47.6146, longitude: -122.3423, source: "nominatim" };
const slu: GeocodeResult = { label: "South Lake Union, Seattle", latitude: 47.6232, longitude: -122.3360, source: "nominatim" };
const pioneer: GeocodeResult = { label: "Pioneer Square, Seattle", latitude: 47.6005, longitude: -122.3321, source: "nominatim" };

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("searchHistory", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadRecentPlaces()).toEqual([]);
  });

  it("prepends a new place and returns it first", () => {
    addRecentPlace(pike);
    const result = addRecentPlace(capitol);
    expect(result[0]).toEqual(capitol);
    expect(result[1]).toEqual(pike);
  });

  it("caps the list at 5 entries, dropping the oldest", () => {
    addRecentPlace(pike);
    addRecentPlace(capitol);
    addRecentPlace(fremont);
    addRecentPlace(belltown);
    addRecentPlace(slu);
    const result = addRecentPlace(pioneer);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual(pioneer);
    expect(result.find((r) => r.label === pike.label)).toBeUndefined();
  });

  it("deduplicates by label+coords, keeping the most-recent position", () => {
    addRecentPlace(pike);
    addRecentPlace(capitol);
    const result = addRecentPlace(pike);
    // pike should now be first, and appear only once
    expect(result[0]).toEqual(pike);
    expect(result.filter((r) => r.label === pike.label)).toHaveLength(1);
  });

  it("preserves order: most-recent first", () => {
    addRecentPlace(pike);
    addRecentPlace(capitol);
    addRecentPlace(fremont);
    const loaded = loadRecentPlaces();
    expect(loaded[0].label).toBe(fremont.label);
    expect(loaded[1].label).toBe(capitol.label);
    expect(loaded[2].label).toBe(pike.label);
  });

  it("falls back to an empty list when localStorage throws on read", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadRecentPlaces()).toEqual([]);
  });

  it("silently ignores a write failure and returns the in-memory list", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const result = addRecentPlace(pike);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(pike);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/searchHistory.test.ts
```

Expected: FAIL — `Cannot find module './searchHistory'`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/searchHistory.ts`:

```typescript
import type { GeocodeResult } from "../types";

const RECENT_KEY = "waypoint.search.recent";
const MAX_RECENT = 5;

function dedupeKey(r: GeocodeResult): string {
  return `${r.label}|${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
}

export function loadRecentPlaces(): GeocodeResult[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GeocodeResult[];
  } catch {
    // private mode or disabled storage degrades to empty list
    return [];
  }
}

export function addRecentPlace(result: GeocodeResult): GeocodeResult[] {
  const existing = loadRecentPlaces();
  const key = dedupeKey(result);
  const deduped = existing.filter((r) => dedupeKey(r) !== key);
  const next = [result, ...deduped].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore: quota exceeded or disabled storage degrades gracefully
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/searchHistory.test.ts
```

Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/lib/searchHistory.ts" "frontend/src/lib/searchHistory.test.ts"
git commit -m "feat(frontend): add searchHistory module with localStorage recent-places (cap 5, dedup)"
```

---

## Task 2: Seattle guard in `geocoding.ts` + extend `geocoding.test.ts`

**Files:**
- Modify: `frontend/src/lib/geocoding.ts`
- Modify: `frontend/src/lib/geocoding.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these test cases to the bottom of `frontend/src/lib/geocoding.test.ts` (inside the existing `describe` block is fine, or as a new `describe`):

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackendProvider, SEATTLE_BBOX, withinSeattleBbox } from "./geocoding";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBackendProvider", () => {
  it("queries the backend endpoint and returns its GeocodeResult rows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBackendProvider();
    const results = await provider.search("pike place");

    expect(results).toEqual([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/dashboard/geocode");
    expect(calledUrl).toContain("q=pike%20place");
  });

  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = createBackendProvider();

    expect(await provider.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the backend responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }));
    const provider = createBackendProvider();

    await expect(provider.search("x")).rejects.toThrow("Search failed with status 502");
  });

  it("filters out results outside the Seattle bbox", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          // inside bbox
          { label: "Capitol Hill, Seattle", latitude: 47.625, longitude: -122.322, source: "nominatim" },
          // outside bbox — Times Square, NYC
          { label: "Times Square, New York", latitude: 40.758, longitude: -73.985, source: "nominatim" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBackendProvider();
    const results = await provider.search("capitol hill");

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("Capitol Hill, Seattle");
  });
});

describe("SEATTLE_BBOX", () => {
  it("exports the expected bounding box constants", () => {
    expect(SEATTLE_BBOX).toEqual({ west: -122.55, north: 47.78, east: -122.10, south: 47.43 });
  });
});

describe("withinSeattleBbox", () => {
  it("returns true for a result clearly inside the bbox", () => {
    expect(withinSeattleBbox({ label: "Pike Place", latitude: 47.6097, longitude: -122.3331, source: "nominatim" })).toBe(true);
  });

  it("returns false for a result outside the bbox (NYC)", () => {
    expect(withinSeattleBbox({ label: "Times Square", latitude: 40.758, longitude: -73.985, source: "nominatim" })).toBe(false);
  });

  it("returns false for a result with latitude above north bound", () => {
    expect(withinSeattleBbox({ label: "Too Far North", latitude: 47.90, longitude: -122.33, source: "nominatim" })).toBe(false);
  });

  it("returns false for a result with longitude west of west bound", () => {
    expect(withinSeattleBbox({ label: "Too Far West", latitude: 47.60, longitude: -122.60, source: "nominatim" })).toBe(false);
  });
});
```

The full replacement file for `frontend/src/lib/geocoding.test.ts` is:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackendProvider, SEATTLE_BBOX, withinSeattleBbox } from "./geocoding";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBackendProvider", () => {
  it("queries the backend endpoint and returns its GeocodeResult rows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBackendProvider();
    const results = await provider.search("pike place");

    expect(results).toEqual([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/dashboard/geocode");
    expect(calledUrl).toContain("q=pike%20place");
  });

  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = createBackendProvider();

    expect(await provider.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the backend responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }));
    const provider = createBackendProvider();

    await expect(provider.search("x")).rejects.toThrow("Search failed with status 502");
  });

  it("filters out results outside the Seattle bbox", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { label: "Capitol Hill, Seattle", latitude: 47.625, longitude: -122.322, source: "nominatim" },
          { label: "Times Square, New York", latitude: 40.758, longitude: -73.985, source: "nominatim" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBackendProvider();
    const results = await provider.search("capitol hill");

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("Capitol Hill, Seattle");
  });
});

describe("SEATTLE_BBOX", () => {
  it("exports the expected bounding box constants", () => {
    expect(SEATTLE_BBOX).toEqual({ west: -122.55, north: 47.78, east: -122.10, south: 47.43 });
  });
});

describe("withinSeattleBbox", () => {
  it("returns true for a result clearly inside the bbox", () => {
    expect(withinSeattleBbox({ label: "Pike Place", latitude: 47.6097, longitude: -122.3331, source: "nominatim" })).toBe(true);
  });

  it("returns false for a result outside the bbox (NYC)", () => {
    expect(withinSeattleBbox({ label: "Times Square", latitude: 40.758, longitude: -73.985, source: "nominatim" })).toBe(false);
  });

  it("returns false for a result with latitude above north bound", () => {
    expect(withinSeattleBbox({ label: "Too Far North", latitude: 47.90, longitude: -122.33, source: "nominatim" })).toBe(false);
  });

  it("returns false for a result with longitude west of west bound", () => {
    expect(withinSeattleBbox({ label: "Too Far West", latitude: 47.60, longitude: -122.60, source: "nominatim" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/geocoding.test.ts
```

Expected: FAIL — `SEATTLE_BBOX` and `withinSeattleBbox` are not exported

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `frontend/src/lib/geocoding.ts`:

```typescript
import type { GeocodeResult } from "../types";

export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
}

// Mirrors backend app/config.py geocoder_viewbox, which is the source of truth.
// Client-side defense-in-depth: even if the backend config drifts, non-Seattle results
// are filtered before they reach the UI.
export const SEATTLE_BBOX = {
  west: -122.55,
  north: 47.78,
  east: -122.10,
  south: 47.43,
} as const;

export function withinSeattleBbox(result: GeocodeResult): boolean {
  return (
    result.latitude >= SEATTLE_BBOX.south &&
    result.latitude <= SEATTLE_BBOX.north &&
    result.longitude >= SEATTLE_BBOX.west &&
    result.longitude <= SEATTLE_BBOX.east
  );
}

// The browser no longer calls a public geocoder directly. It calls the
// session-required backend proxy (GET /dashboard/geocode), which caches results
// and is polite to the upstream provider. Same-origin in production; the Vite
// dev server proxies /dashboard to the backend.
export function createBackendProvider(endpoint = "/dashboard/geocode"): GeocodingProvider {
  return {
    async search(query, signal) {
      const trimmed = query.trim();
      if (!trimmed) {
        return [];
      }
      const url = `${endpoint}?q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, {
        signal,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }
      const results = (await response.json()) as GeocodeResult[];
      return results.filter(withinSeattleBbox);
    },
  };
}

export const geocodingProvider = createBackendProvider();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/geocoding.test.ts
```

Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/lib/geocoding.ts" "frontend/src/lib/geocoding.test.ts"
git commit -m "feat(frontend): add SEATTLE_BBOX + withinSeattleBbox; filter provider results client-side"
```

---

## Task 3: `useAddressSearch.ts` — `empty` status + shared copy constants + update test

**Files:**
- Modify: `frontend/src/lib/useAddressSearch.ts`
- Modify: `frontend/src/lib/useAddressSearch.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/lib/useAddressSearch.test.ts`:

```typescript
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG, useAddressSearch } from "./useAddressSearch";

describe("useAddressSearch", () => {
  it("runs a trimmed search and exposes the results with done status", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("  pike  "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).toHaveBeenCalledWith("pike");
    expect(result.current.status).toBe("done");
    expect(result.current.results).toHaveLength(1);
  });

  it("does not call search for a blank query and stays idle", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("   "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("reports an error status and clears results when the search rejects", async () => {
    const search = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("x"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.results).toEqual([]);
  });

  it("sets empty status when the search resolves with zero results", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("xyzzy-no-match"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("empty");
    expect(result.current.results).toEqual([]);
  });

  it("exports the shared copy constants", () => {
    expect(SEARCH_EMPTY_MSG).toBe("No matches. Drop a pin on the map instead.");
    expect(SEARCH_ERROR_MSG).toBe("Search is unavailable. Drop a pin on the map instead.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/useAddressSearch.test.ts
```

Expected: FAIL — `SEARCH_EMPTY_MSG`, `SEARCH_ERROR_MSG` not exported; `empty` status not handled; `runSearch` no longer takes an `AbortSignal` argument (search mock called with only `"pike"`)

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `frontend/src/lib/useAddressSearch.ts`:

```typescript
import { useState } from "react";

import type { GeocodeResult } from "../types";

export type AddressSearchStatus = "idle" | "loading" | "done" | "empty" | "error";

export const SEARCH_EMPTY_MSG = "No matches. Drop a pin on the map instead.";
export const SEARCH_ERROR_MSG = "Search is unavailable. Drop a pin on the map instead.";

export interface AddressSearch {
  query: string;
  setQuery: (value: string) => void;
  status: AddressSearchStatus;
  results: GeocodeResult[];
  runSearch: () => Promise<void>;
}

/**
 * Shared address-search state machine for the geocode box used by both the Places map
 * search (PlaceSearch) and the Routes endpoint search (RoutesTab). Owns the query, the
 * trimmed geocode call, and the loading/done/empty/error status; callers render the input and
 * the results however they need (a clickable list for Places, endpoint options for Routes).
 */
export function useAddressSearch(
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
): AddressSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>("idle");

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setStatus("loading");
    try {
      const found = await search(trimmed);
      setResults(found);
      setStatus(found.length === 0 ? "empty" : "done");
    } catch {
      setResults([]);
      setStatus("error");
    }
  }

  return { query, setQuery, status, results, runSearch };
}
```

> Note: this intermediate step keeps the original single-arg `search(trimmed)` call; the
> `AbortSignal` second argument is introduced in Task 4, where the assertions switch to
> `expect.anything()` for the signal.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/useAddressSearch.test.ts
```

Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/lib/useAddressSearch.ts" "frontend/src/lib/useAddressSearch.test.ts"
git commit -m "feat(frontend): add empty status + SEARCH_EMPTY_MSG/SEARCH_ERROR_MSG to useAddressSearch"
```

---

## Task 4: `useAddressSearch.ts` — debounce + abort + tests

**Files:**
- Modify: `frontend/src/lib/useAddressSearch.ts`
- Modify: `frontend/src/lib/useAddressSearch.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/lib/useAddressSearch.test.ts`:

```typescript
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEBOUNCE_MS, SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG, useAddressSearch } from "./useAddressSearch";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("useAddressSearch", () => {
  // ── direct runSearch (immediate, existing behaviour) ─────────────────────

  it("runSearch runs a trimmed search immediately and exposes done results", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("  pike  "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).toHaveBeenCalledWith("pike", expect.anything());
    expect(result.current.status).toBe("done");
    expect(result.current.results).toHaveLength(1);
  });

  it("runSearch does not call search for a blank query and stays idle", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("   "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("runSearch reports error status and clears results when the search rejects", async () => {
    const search = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("x"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.results).toEqual([]);
  });

  it("runSearch sets empty status when the search resolves with zero results", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("xyzzy-no-match"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("empty");
    expect(result.current.results).toEqual([]);
  });

  it("exports the shared copy constants", () => {
    expect(SEARCH_EMPTY_MSG).toBe("No matches. Drop a pin on the map instead.");
    expect(SEARCH_ERROR_MSG).toBe("Search is unavailable. Drop a pin on the map instead.");
  });

  it("exports DEBOUNCE_MS as 300", () => {
    expect(DEBOUNCE_MS).toBe(300);
  });

  // ── debounce + abort ──────────────────────────────────────────────────────

  it("debounce fires once ~300 ms after the last keystroke", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Capitol Hill", latitude: 47.625, longitude: -122.322, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("cap"));
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cap", expect.anything());
    expect(result.current.status).toBe("done");
  });

  it("typing again before 300 ms cancels the prior debounce call", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("ca"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setQuery("cap"));
    act(() => vi.advanceTimersByTime(100));
    // still under 300 ms from the second keystroke
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    // only called once for the final query
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cap", expect.anything());
  });

  it("a newer query result wins: stale/aborted responses are ignored", async () => {
    let resolveFirst!: (v: { label: string; latitude: number; longitude: number; source: string }[]) => void;
    const first = new Promise<{ label: string; latitude: number; longitude: number; source: string }[]>((res) => { resolveFirst = res; });
    const second = Promise.resolve([{ label: "Capitol Hill", latitude: 47.625, longitude: -122.322, source: "nominatim" }]);

    let callCount = 0;
    const search = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? first : second;
    });

    const { result } = renderHook(() => useAddressSearch(search));

    // fire debounce for "ca"
    act(() => result.current.setQuery("ca"));
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });

    // fire debounce for "cap" before first resolves
    act(() => result.current.setQuery("cap"));
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });

    // second call resolves immediately; first resolves late
    resolveFirst([{ label: "Stale Result", latitude: 47.50, longitude: -122.30, source: "nominatim" }]);
    await act(async () => { await Promise.resolve(); });

    expect(result.current.results[0]?.label).toBe("Capitol Hill");
  });

  it("blank query resets to idle and clears results without calling search", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    // populate results first
    act(() => result.current.setQuery("pike"));
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(result.current.status).toBe("done");

    // clear the query
    await act(async () => { result.current.setQuery(""); });
    expect(result.current.status).toBe("idle");
    expect(result.current.results).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("unmounting clears the timer (no state update after unmount)", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result, unmount } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("pike"));
    unmount();
    // advance past debounce — should not throw / update
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS * 2); });
    expect(search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/useAddressSearch.test.ts
```

Expected: FAIL — `DEBOUNCE_MS` not exported; debounce tests fail (search fires immediately, not after timer)

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `frontend/src/lib/useAddressSearch.ts`:

```typescript
import { useEffect, useRef, useState } from "react";

import type { GeocodeResult } from "../types";

export type AddressSearchStatus = "idle" | "loading" | "done" | "empty" | "error";

export const DEBOUNCE_MS = 300;
export const SEARCH_EMPTY_MSG = "No matches. Drop a pin on the map instead.";
export const SEARCH_ERROR_MSG = "Search is unavailable. Drop a pin on the map instead.";

export interface AddressSearch {
  query: string;
  setQuery: (value: string) => void;
  status: AddressSearchStatus;
  results: GeocodeResult[];
  runSearch: () => Promise<void>;
}

/**
 * Shared address-search state machine for the geocode box used by both the Places map
 * search (PlaceSearch) and the Routes endpoint search (RoutesTab). Owns the query, the
 * trimmed geocode call, and the loading/done/empty/error status; callers render the input and
 * the results however they need (a clickable list for Places, endpoint options for Routes).
 *
 * Type-ahead: a useEffect on query debounces the search ~300 ms after the last keystroke,
 * aborting any in-flight stale request. runSearch() bypasses the debounce for immediate
 * triggers (Enter key / Search button).
 */
export function useAddressSearch(
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
): AddressSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>("idle");

  // Holds the AbortController for the in-flight debounced request.
  const abortRef = useRef<AbortController | null>(null);
  // Holds the debounce timer id.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    // Clear any pending debounce and abort the current in-flight request.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (!trimmed) {
      setResults([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStatus("loading");
      search(trimmed, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setStatus(found.length === 0 ? "empty" : "done");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      controller.abort();
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    // Cancel the pending debounce so we don't double-fire.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    try {
      const found = await search(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      setStatus(found.length === 0 ? "empty" : "done");
    } catch {
      if (controller.signal.aborted) return;
      setResults([]);
      setStatus("error");
    }
  }

  return { query, setQuery, status, results, runSearch };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/useAddressSearch.test.ts
```

Expected: PASS — all 13 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/lib/useAddressSearch.ts" "frontend/src/lib/useAddressSearch.test.ts"
git commit -m "feat(frontend): add debounce + abort to useAddressSearch; export DEBOUNCE_MS"
```

---

## Task 5: `useAddressSearch.ts` — recent places + `rememberPlace` + tests

**Files:**
- Modify: `frontend/src/lib/useAddressSearch.ts`
- Modify: `frontend/src/lib/useAddressSearch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases to `frontend/src/lib/useAddressSearch.test.ts`. Replace the entire file:

```typescript
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEBOUNCE_MS, SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG, useAddressSearch } from "./useAddressSearch";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useAddressSearch", () => {
  // ── direct runSearch (immediate) ──────────────────────────────────────────

  it("runSearch runs a trimmed search immediately and exposes done results", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("  pike  "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).toHaveBeenCalledWith("pike", expect.anything());
    expect(result.current.status).toBe("done");
    expect(result.current.results).toHaveLength(1);
  });

  it("runSearch does not call search for a blank query and stays idle", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("   "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("runSearch reports error status and clears results when the search rejects", async () => {
    const search = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("x"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.results).toEqual([]);
  });

  it("runSearch sets empty status when the search resolves with zero results", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("xyzzy-no-match"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("empty");
    expect(result.current.results).toEqual([]);
  });

  it("exports the shared copy constants", () => {
    expect(SEARCH_EMPTY_MSG).toBe("No matches. Drop a pin on the map instead.");
    expect(SEARCH_ERROR_MSG).toBe("Search is unavailable. Drop a pin on the map instead.");
  });

  it("exports DEBOUNCE_MS as 300", () => {
    expect(DEBOUNCE_MS).toBe(300);
  });

  // ── debounce + abort ──────────────────────────────────────────────────────

  it("debounce fires once ~300 ms after the last keystroke", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Capitol Hill", latitude: 47.625, longitude: -122.322, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("cap"));
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cap", expect.anything());
    expect(result.current.status).toBe("done");
  });

  it("typing again before 300 ms cancels the prior debounce call", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("ca"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setQuery("cap"));
    act(() => vi.advanceTimersByTime(100));
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cap", expect.anything());
  });

  it("a newer query result wins: stale/aborted responses are ignored", async () => {
    let resolveFirst!: (v: { label: string; latitude: number; longitude: number; source: string }[]) => void;
    const first = new Promise<{ label: string; latitude: number; longitude: number; source: string }[]>((res) => { resolveFirst = res; });
    const second = Promise.resolve([{ label: "Capitol Hill", latitude: 47.625, longitude: -122.322, source: "nominatim" }]);

    let callCount = 0;
    const search = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? first : second;
    });

    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("ca"));
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });

    act(() => result.current.setQuery("cap"));
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });

    resolveFirst([{ label: "Stale Result", latitude: 47.50, longitude: -122.30, source: "nominatim" }]);
    await act(async () => { await Promise.resolve(); });

    expect(result.current.results[0]?.label).toBe("Capitol Hill");
  });

  it("blank query resets to idle and clears results without calling search", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("pike"));
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(result.current.status).toBe("done");

    await act(async () => { result.current.setQuery(""); });
    expect(result.current.status).toBe("idle");
    expect(result.current.results).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("unmounting clears the timer (no state update after unmount)", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result, unmount } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("pike"));
    unmount();
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS * 2); });
    expect(search).not.toHaveBeenCalled();
  });

  // ── recent places + rememberPlace ─────────────────────────────────────────

  it("exposes an empty recent list on mount when nothing is stored", () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));
    expect(result.current.recent).toEqual([]);
  });

  it("loads persisted recent places on mount", () => {
    const pike = { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0]).toEqual(pike);
  });

  it("rememberPlace updates the recent list in state and persists it", () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));
    const pike = { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" };

    act(() => { result.current.rememberPlace(pike); });

    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0]).toEqual(pike);
    const stored = JSON.parse(localStorage.getItem("waypoint.search.recent") ?? "[]");
    expect(stored[0]).toEqual(pike);
  });

  it("rememberPlace deduplicates and keeps the most recent first", () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));
    const pike = { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" };
    const capitol = { label: "Capitol Hill", latitude: 47.625, longitude: -122.322, source: "nominatim" };

    act(() => { result.current.rememberPlace(pike); });
    act(() => { result.current.rememberPlace(capitol); });
    act(() => { result.current.rememberPlace(pike); });

    expect(result.current.recent[0]).toEqual(pike);
    expect(result.current.recent.filter((r) => r.label === pike.label)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/useAddressSearch.test.ts
```

Expected: FAIL — `result.current.recent` is `undefined`; `result.current.rememberPlace` is not a function

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `frontend/src/lib/useAddressSearch.ts`:

```typescript
import { useEffect, useRef, useState } from "react";

import type { GeocodeResult } from "../types";
import { addRecentPlace, loadRecentPlaces } from "./searchHistory";

export type AddressSearchStatus = "idle" | "loading" | "done" | "empty" | "error";

export const DEBOUNCE_MS = 300;
export const SEARCH_EMPTY_MSG = "No matches. Drop a pin on the map instead.";
export const SEARCH_ERROR_MSG = "Search is unavailable. Drop a pin on the map instead.";

export interface AddressSearch {
  query: string;
  setQuery: (value: string) => void;
  status: AddressSearchStatus;
  results: GeocodeResult[];
  recent: GeocodeResult[];
  runSearch: () => Promise<void>;
  rememberPlace: (result: GeocodeResult) => void;
}

/**
 * Shared address-search state machine for the geocode box used by both the Places map
 * search (PlaceSearch) and the Routes endpoint search (RoutesTab). Owns the query, the
 * trimmed geocode call, and the loading/done/empty/error status; callers render the input and
 * the results however they need (a clickable list for Places, endpoint options for Routes).
 *
 * Type-ahead: a useEffect on query debounces the search ~300 ms after the last keystroke,
 * aborting any in-flight stale request. runSearch() bypasses the debounce for immediate
 * triggers (Enter key / Search button).
 *
 * Recent places: loaded from localStorage on mount; updated via rememberPlace (call inside
 * the consumer's existing select handler so selection logic stays in the consumer).
 */
export function useAddressSearch(
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
): AddressSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>("idle");
  const [recent, setRecent] = useState<GeocodeResult[]>(() => loadRecentPlaces());

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (!trimmed) {
      setResults([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStatus("loading");
      search(trimmed, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setStatus(found.length === 0 ? "empty" : "done");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      controller.abort();
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    try {
      const found = await search(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      setStatus(found.length === 0 ? "empty" : "done");
    } catch {
      if (controller.signal.aborted) return;
      setResults([]);
      setStatus("error");
    }
  }

  function rememberPlace(result: GeocodeResult) {
    const next = addRecentPlace(result);
    setRecent(next);
  }

  return { query, setQuery, status, results, recent, runSearch, rememberPlace };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/lib/useAddressSearch.test.ts
```

Expected: PASS — all 17 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/lib/useAddressSearch.ts" "frontend/src/lib/useAddressSearch.test.ts"
git commit -m "feat(frontend): add recent places + rememberPlace to useAddressSearch"
```

---

## Task 6: `PlaceSearch.tsx` + extend `PlaceSearch.test.tsx`

**Files:**
- Modify: `frontend/src/components/PlaceSearch.tsx`
- Modify: `frontend/src/components/PlaceSearch.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/PlaceSearch.test.tsx`:

```typescript
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaceSearch } from "./PlaceSearch";
import type { GeocodingProvider } from "../lib/geocoding";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function providerReturning(results = [{ label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" }]): GeocodingProvider {
  return {
    search: vi.fn().mockResolvedValue(results),
  };
}

describe("PlaceSearch", () => {
  it("searches on submit and emits the chosen result", async () => {
    const onSelectResult = vi.fn();
    render(<PlaceSearch provider={providerReturning()} onSelectResult={onSelectResult} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "pike place" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const result = await screen.findByText("Pike Place Market, Seattle");
    fireEvent.click(result);
    expect(onSelectResult).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Pike Place Market, Seattle", latitude: 47.6097 }),
    );
  });

  it("shows the shared error message when search fails (status=error)", async () => {
    const provider: GeocodingProvider = { search: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<PlaceSearch provider={provider} onSelectResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Search is unavailable. Drop a pin on the map instead."));
  });

  it("shows the shared empty message when search returns zero results (status=empty)", async () => {
    const provider: GeocodingProvider = { search: vi.fn().mockResolvedValue([]) };
    render(<PlaceSearch provider={provider} onSelectResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "xyzzy" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("No matches. Drop a pin on the map instead.")).toBeInTheDocument());
  });

  it("does not show the recent list when the input is not focused", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);

    expect(screen.queryByRole("list", { name: "Recent searches" })).not.toBeInTheDocument();
  });

  it("shows the recent list when the input is focused and query is empty", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);

    fireEvent.focus(screen.getByLabelText("Search an address or place"));

    expect(screen.getByRole("list", { name: "Recent searches" })).toBeInTheDocument();
    expect(screen.getByText("Pike Place Market, Seattle")).toBeInTheDocument();
  });

  it("hides the recent list once the user starts typing", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);

    fireEvent.focus(screen.getByLabelText("Search an address or place"));
    expect(screen.getByRole("list", { name: "Recent searches" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "pike" } });
    expect(screen.queryByRole("list", { name: "Recent searches" })).not.toBeInTheDocument();
  });

  it("clicking a recent result calls rememberPlace and onSelectResult", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    const onSelectResult = vi.fn();
    render(<PlaceSearch provider={providerReturning()} onSelectResult={onSelectResult} />);

    fireEvent.focus(screen.getByLabelText("Search an address or place"));
    // Recent items use onMouseDown (fires before the input's blur), so drive mousedown here.
    fireEvent.mouseDown(screen.getByText("Pike Place Market, Seattle"));

    expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ label: "Pike Place Market, Seattle" }));
    // also persists: the recent list in localStorage still contains the entry
    const stored = JSON.parse(localStorage.getItem("waypoint.search.recent") ?? "[]");
    expect(stored[0].label).toBe("Pike Place Market, Seattle");
  });

  it("does not show the recent list when there are no recent places", () => {
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);
    fireEvent.focus(screen.getByLabelText("Search an address or place"));
    expect(screen.queryByRole("list", { name: "Recent searches" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/components/PlaceSearch.test.tsx
```

Expected: FAIL — recent list tests fail (list not rendered on focus), empty message test fails (old code checks `status === "done" && results.length === 0` but new status is `"empty"`), error message test fails (old copy doesn't match shared constant)

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `frontend/src/components/PlaceSearch.tsx`:

```typescript
import { type FormEvent, useState } from "react";

import { useAddressSearch, SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG } from "../lib/useAddressSearch";
import type { GeocodingProvider } from "../lib/geocoding";
import type { GeocodeResult } from "../types";

type Props = {
  provider: GeocodingProvider;
  onSelectResult: (result: GeocodeResult) => void;
};

export function PlaceSearch({ provider, onSelectResult }: Props) {
  const { query, setQuery, status, results, recent, runSearch, rememberPlace } = useAddressSearch(provider.search);
  const [focused, setFocused] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function handleSelect(result: GeocodeResult) {
    rememberPlace(result);
    onSelectResult(result);
  }

  const showRecent = focused && query.trim() === "" && recent.length > 0;

  return (
    <div className="mc-search-wrap">
      <form className="mc-search mc-search--sheet" onSubmit={onSubmit} role="search">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search an address or place"
          aria-label="Search an address or place"
        />
        <button type="submit" className="mc-search-go">Search</button>
      </form>
      {status === "error" ? (
        <p className="mc-search-msg" role="alert">{SEARCH_ERROR_MSG}</p>
      ) : null}
      {status === "empty" ? (
        <p className="mc-search-msg">{SEARCH_EMPTY_MSG}</p>
      ) : null}
      {showRecent ? (
        <ul className="mc-results mc-recent" aria-label="Recent searches">
          {recent.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button type="button" onMouseDown={() => handleSelect(r)}>
                <span className="mc-result-label">{r.label}</span>
                <span className="mc-result-coord">{r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {results.length > 0 ? (
        <ul className="mc-results" aria-label="Search results">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button type="button" onClick={() => handleSelect(result)}>
                <span className="mc-result-label">{result.label}</span>
                <span className="mc-result-coord">{result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

**Note on `onMouseDown` vs `onClick` for the recent list:** The input's `onBlur` fires before a child button's `onClick`, which would hide the list before the click registers. Using `onMouseDown` on the recent buttons prevents this — the mousedown fires before blur.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/components/PlaceSearch.test.tsx
```

Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/components/PlaceSearch.tsx" "frontend/src/components/PlaceSearch.test.tsx"
git commit -m "feat(frontend): PlaceSearch shows recent list on focus-empty; uses shared copy constants"
```

---

## Task 7: `RoutesTab.tsx` + extend `RoutesTab.test.tsx`

**Files:**
- Modify: `frontend/src/components/RoutesTab.tsx`
- Modify: `frontend/src/components/RoutesTab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/RoutesTab.test.tsx`:

```typescript
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoutesTab } from "./RoutesTab";
import type { AnalysisSettings, Place, RouteComparison } from "../types";

const analysis: AnalysisSettings = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 500, offenseCategory: "" };

const places: Place[] = [
  { id: "p1", display_label: "Home", latitude: 47.62, longitude: -122.33, visit_count: 1, total_dwell_minutes: null, inferred_place_type: "home", sensitivity_class: "normal" },
  { id: "p2", display_label: "Office", latitude: 47.61, longitude: -122.34, visit_count: 1, total_dwell_minutes: null, inferred_place_type: "work", sensitivity_class: "normal" },
];

const twoAlt: RouteComparison = {
  request: { id: "r1", origin: { label: "Home" }, destination: { label: "Office" }, mode: "transit" },
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

const oneAlt: RouteComparison = { ...twoAlt, alternatives: [twoAlt.alternatives[0]], statistical_comparison: null };
const noAlt: RouteComparison = { ...twoAlt, alternatives: [], context_summaries: [], statistical_comparison: null };
const twoAltNoVerdict: RouteComparison = { ...twoAlt, statistical_comparison: null };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("RoutesTab", () => {
  it("renders the verdict and a block per alternative", () => {
    render(<RoutesTab analysis={analysis} running={false} result={twoAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower reported-incident rate/i)).toBeInTheDocument();
    expect(screen.getByText("Link light rail via Westlake")).toBeInTheDocument();
    expect(screen.getByText("Pine Street bus")).toBeInTheDocument();
  });

  it("omits the verdict for a single route", () => {
    render(<RoutesTab analysis={analysis} running={false} result={oneAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("does not claim a single option when multiple routes lack a verdict", () => {
    render(<RoutesTab analysis={analysis} running={false} result={twoAltNoVerdict} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText("Link light rail via Westlake")).toBeInTheDocument();
    expect(screen.getByText("Pine Street bus")).toBeInTheDocument();
    expect(screen.queryByText(/one route option/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing to compare/i)).not.toBeInTheDocument();
  });

  it("shows a no-route message when there are zero alternatives", () => {
    render(<RoutesTab analysis={analysis} running={false} result={noAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/no route found/i)).toBeInTheDocument();
  });

  it("lists saved places in the From and To pickers", () => {
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Home" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Office" }).length).toBe(2);
  });

  it("runs with the selected place endpoints", () => {
    const onRun = vi.fn();
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={onRun} />);
    fireEvent.click(within(screen.getByRole("list", { name: "From options" })).getByRole("button", { name: "Home" }));
    fireEvent.click(within(screen.getByRole("list", { name: "To options" })).getByRole("button", { name: "Office" }));
    fireEvent.click(screen.getByRole("button", { name: /compare routes/i }));
    expect(onRun).toHaveBeenCalledWith({ place_id: "p1" }, { place_id: "p2" }, "transit");
  });

  it("searches an address and makes it selectable", async () => {
    const geocodeSearch = vi.fn().mockResolvedValue([{ label: "400 Broad St", latitude: 47.62, longitude: -122.35, source: "nominatim" }]);
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "400 Broad" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findAllByRole("button", { name: /400 Broad St/ });
    expect(geocodeSearch).toHaveBeenCalledWith("400 Broad", expect.anything());
  });

  it("shows the shared error message in the address field when search fails", async () => {
    const geocodeSearch = vi.fn().mockRejectedValue(new Error("boom"));
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Search is unavailable. Drop a pin on the map instead.");
  });

  it("shows the shared empty message when search returns zero results", async () => {
    const geocodeSearch = vi.fn().mockResolvedValue([]);
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "xyzzy" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("No matches. Drop a pin on the map instead.");
  });

  it("shows recent addresses as From/To options when there is no active search", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    // Recent options should appear in both From and To lists
    const pikeButtons = screen.getAllByRole("button", { name: "Pike Place Market, Seattle" });
    expect(pikeButtons.length).toBe(2);
  });

  it("hides recent addresses from options once a search is active (geo results present)", async () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    const capitol = { label: "Capitol Hill, Seattle", latitude: 47.625, longitude: -122.322, source: "nominatim" };
    const geocodeSearch = vi.fn().mockResolvedValue([capitol]);
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "cap" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findAllByRole("button", { name: /Capitol Hill/ });
    expect(screen.queryByRole("button", { name: /Pike Place Market/ })).not.toBeInTheDocument();
  });

  it("selecting a geocoded result from EndpointChooser calls rememberPlace", async () => {
    const broad = { label: "400 Broad St, Seattle", latitude: 47.62, longitude: -122.35, source: "nominatim" };
    const geocodeSearch = vi.fn().mockResolvedValue([broad]);
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "400 Broad" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findAllByRole("button", { name: /400 Broad St/ });
    // Select from the From list
    fireEvent.click(within(screen.getByRole("list", { name: "From options" })).getByRole("button", { name: /400 Broad St/ }));
    // Should now appear in recent
    const stored = JSON.parse(localStorage.getItem("waypoint.search.recent") ?? "[]");
    expect(stored[0].label).toBe("400 Broad St, Seattle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/components/RoutesTab.test.tsx
```

Expected: FAIL — `geocodeSearch` called without second argument in old search test; shared error/empty copy assertions fail (old strings used); recent-in-options tests fail; `rememberPlace` not called on selection

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `frontend/src/components/RoutesTab.tsx`:

```typescript
import { useMemo, useState } from "react";
import { useAddressSearch, SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG } from "../lib/useAddressSearch";
import type { AnalysisSettings, GeocodeResult, Place, RouteComparison, RouteEndpointInput } from "../types";

const MODES: { value: string; label: string }[] = [
  { value: "transit", label: "Transit" },
  { value: "walk", label: "Walk" },
  { value: "bike", label: "Bike" },
  { value: "drive", label: "Drive" },
];

type EndpointOption = { key: string; label: string; input: RouteEndpointInput; geoResult?: GeocodeResult };

type Props = {
  analysis: AnalysisSettings;
  running: boolean;
  result?: RouteComparison | null;
  error?: string;
  places: Place[];
  geocodeSearch: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onRun: (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string) => void;
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

type LegContext = { label: string; count: number };

function perLegContext(result: RouteComparison, alternativeId: string, radiusM: number): LegContext[] {
  const byLabel = new Map<string, number>();
  for (const row of result.context_summaries) {
    if (row.route_alternative_id !== alternativeId || row.radius_m !== radiusM) continue;
    const label = row.context_label?.trim();
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + row.incident_count);
  }
  return [...byLabel.entries()].map(([label, count]) => ({ label, count }));
}

function EndpointChooser({
  idBase,
  label,
  options,
  selectedKey,
  onSelect,
}: {
  idBase: string;
  label: string;
  options: EndpointOption[];
  selectedKey: string;
  onSelect: (key: string, geoResult?: GeocodeResult) => void;
}) {
  const selected = options.find((option) => option.key === selectedKey) ?? null;
  const [open, setOpen] = useState(false);
  return (
    <div className="mc-field">
      <label id={`${idBase}-label`}>{label}</label>
      {selected && !open ? (
        <div className="mc-chosen">
          <span>{selected.label}</span>
          <button type="button" className="mc-chip" onClick={() => setOpen(true)}>Change</button>
        </div>
      ) : options.length > 0 ? (
        <ul className="mc-results" aria-label={`${label} options`}>
          {options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                aria-pressed={option.key === selectedKey}
                onClick={() => {
                  onSelect(option.key, option.geoResult);
                  setOpen(false);
                }}
              >
                <span className="mc-result-label">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RoutesTab({ analysis, running, result, error, places, geocodeSearch, onRun }: Props) {
  const { query, setQuery, status: searchStatus, results: geoResults, recent, runSearch, rememberPlace } =
    useAddressSearch(geocodeSearch);

  const searchError =
    searchStatus === "error"
      ? SEARCH_ERROR_MSG
      : searchStatus === "empty"
        ? SEARCH_EMPTY_MSG
        : "";

  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [mode, setMode] = useState("transit");

  const options: EndpointOption[] = useMemo(() => {
    const placeOptions = places.map((p) => ({
      key: `place:${p.id}`,
      label: p.display_label,
      input: { place_id: p.id } as RouteEndpointInput,
      geoResult: undefined,
    }));
    const geoOptions = geoResults.map((g) => ({
      key: `geo:${g.latitude},${g.longitude}`,
      label: g.label,
      input: { latitude: g.latitude, longitude: g.longitude, label: g.label } as RouteEndpointInput,
      geoResult: g,
    }));

    // Show recent options only when there is no active geo search result set.
    // Dedup recent against place and geo keys.
    const existingKeys = new Set([...placeOptions.map((o) => o.key), ...geoOptions.map((o) => o.key)]);
    const recentOptions = geoResults.length === 0
      ? recent
        .map((r) => ({
          key: `geo:${r.latitude},${r.longitude}`,
          label: r.label,
          input: { latitude: r.latitude, longitude: r.longitude, label: r.label } as RouteEndpointInput,
          geoResult: r,
        }))
        .filter((o) => !existingKeys.has(o.key))
      : [];

    return [...placeOptions, ...geoOptions, ...recentOptions];
  }, [places, geoResults, recent]);

  function handleEndpointSelect(key: string, geoResult?: GeocodeResult) {
    if (geoResult) {
      rememberPlace(geoResult);
    }
    return key;
  }

  const recommendedId = result?.statistical_comparison?.overview.recommendation_option_id ?? null;
  const originOption = options.find((o) => o.key === originKey) ?? null;
  const destinationOption = options.find((o) => o.key === destinationKey) ?? null;
  const canRun = originOption !== null && destinationOption !== null && !running;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Routes">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="route-address">Find an address</label>
          <div className="mc-field-row">
            <input
              id="route-address"
              className="mc-inp"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 400 Broad St, Seattle"
            />
            <button type="button" className="mc-chip" disabled={searchStatus === "loading"} onClick={() => void runSearch()}>
              {searchStatus === "loading" ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError ? <p className="mc-inline-error" role="alert">{searchError}</p> : null}
        </div>
        <EndpointChooser
          idBase="route-origin"
          label="From"
          options={options}
          selectedKey={originKey}
          onSelect={(key, geoResult) => setOriginKey(handleEndpointSelect(key, geoResult))}
        />
        <EndpointChooser
          idBase="route-destination"
          label="To"
          options={options}
          selectedKey={destinationKey}
          onSelect={(key, geoResult) => setDestinationKey(handleEndpointSelect(key, geoResult))}
        />
        <div className="mc-field">
          <label id="route-mode-label">Mode</label>
          <div className="mc-chips" role="group" aria-labelledby="route-mode-label">
            {MODES.map((m) => (
              <button key={m.value} type="button" className={`mc-chip${mode === m.value ? " on" : ""}`} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="mc-querybar-run">
          <button
            type="button"
            className="mc-cta"
            disabled={!canRun}
            onClick={() => { if (originOption && destinationOption) onRun(originOption.input, destinationOption.input, mode); }}
          >
            {running ? "Routing…" : "Compare routes"}
          </button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {options.length === 0 ? (
        <p className="mc-empty-list">Save places in the Places tab, or search an address above, to route between them.</p>
      ) : null}

      {result ? (
        result.alternatives.length === 0 ? (
          <p className="mc-empty-list">No route found between these points for this mode.</p>
        ) : (
          <>
            {result.statistical_comparison ? (
              <section className="mc-verdict tone-muted" aria-label="Route comparison verdict">
                <p className="mc-verdict-label">{result.statistical_comparison.overview.summary_text}</p>
                <p className="mc-verdict-sub">{result.statistical_comparison.overview.caveat_text}</p>
              </section>
            ) : result.alternatives.length === 1 ? (
              <p className="mc-empty-list">One route option — nothing to compare. Reported-incident context for the corridor is below.</p>
            ) : (
              <p className="mc-empty-list">{result.alternatives.length} route options below — not enough reported-incident context to rank them. Context for each corridor is shown per option.</p>
            )}

            {result.alternatives.map((alt) => {
              const ctx = corridorContext(result, alt.id, analysis.radiusM);
              const legs = perLegContext(result, alt.id, analysis.radiusM);
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
                  {legs.length > 1 ? (
                    <ul className="mc-breakdown" aria-label="Reported incidents near each leg's stops">
                      {legs.map((leg) => (
                        <li key={leg.label} className="mc-breakdown-row">
                          <span>{leg.label}</span>
                          <span className="cnt">{leg.count} reported incident{leg.count === 1 ? "" : "s"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </>
        )
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npx vitest run src/components/RoutesTab.test.tsx
```

Expected: PASS — all 13 tests green

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/components/RoutesTab.tsx" "frontend/src/components/RoutesTab.test.tsx"
git commit -m "feat(frontend): RoutesTab shows recent options; rememberPlace on select; shared copy constants"
```

---

## Task 8: `mapWorkspace.css` — add `.mc-recent` styles

**Files:**
- Modify: `frontend/src/styles/mapWorkspace.css`

- [ ] **Step 1: Identify where to add styles**

The file already contains `.mc-results` (line ~353–357) and `.mc-result-label` / `.mc-result-coord` (lines ~356–357). The recent list reuses `.mc-results` and the same button look. We only need a small heading class + a subtle distinguishing rule for the recent section wrapper.

There are no new colors needed — only existing CSS custom properties (`--dim`, `--faint`, `--ink-raise`, `--line`, `--text`, `--clay`, `--f-ui`, `--f-mono`).

- [ ] **Step 2: Append the new rules**

At the end of `frontend/src/styles/mapWorkspace.css`, add:

```css
/* Recent searches — reuses mc-results list look; adds a small section heading */
.mc-recent-wrap{display:grid;gap:6px;}
.mc-recent-heading{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);}
.mc-recent{border-top:1px solid var(--line);padding-top:6px;}
```

The `mc-recent` class is added alongside `mc-results` on the `<ul>` in `PlaceSearch.tsx` (already done in Task 6), giving the list a visual separator when it appears directly below the search form. `.mc-recent-wrap` and `.mc-recent-heading` are available for future use if a "Recent" label is desired above the list.

- [ ] **Step 3: Verify the build still compiles (no CSS errors)**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish/frontend" && npm run build 2>&1 | tail -20
```

Expected: build exits 0 with no CSS parse errors

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/styles/mapWorkspace.css"
git commit -m "style(frontend): add mc-recent CSS for recent-searches list section"
```

---

## Task 9: `docs/ROADMAP.md` — tick Phase 4 · H3 (DEFERRED to integration)

**Do NOT edit `docs/ROADMAP.md` in this task.** The canonical **Phase 4** section is
introduced by PR #71 (item C1), which is open against `main` but not yet merged. If this
branch also added a Phase 4 section, the two PRs would conflict on the same region of
`docs/ROADMAP.md`.

The orchestrator handles the H3 roadmap tick at **integration time**: after #71 merges, the
branch is rebased on `main` (which then already has the Phase 4 section with C1 ticked) and
**H3 is flipped `[ ]` → `[x]`** in a single clean commit before the PR is finalized. No code or
commit is produced by this task.

---

## Task 10: Final gate — `make test-all` + live smoke checklist

**Files:** (none — verification only)

- [ ] **Step 1: Run the full test gate**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish" && make test-all
```

Expected: all of the following green —
- `pytest` backend tests
- `ruff check .` linting (0 errors)
- frontend `npm test` (all Vitest suites pass)
- `npm run build` (Vite build exits 0)

If any step fails, fix it before proceeding. Common fixes:
- TypeScript errors: run `cd frontend && npx tsc --noEmit` to get precise error locations
- Ruff errors: run `ruff check . --fix` for auto-fixable issues
- Vitest failures: run the specific test file to isolate

- [ ] **Step 2: Live smoke — start the dev server**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish" && make run
```

Open the app in a browser (default: `http://localhost:5173` via Vite proxy or `http://localhost:8000`).

- [ ] **Step 3: Live smoke — Seattle address resolves**

1. Navigate to the **Places** tab.
2. In the search box, type a specific Seattle address (e.g. `1400 E Olive Way`).
3. Wait ~300 ms (do not press Enter).
4. Confirm: results appear automatically with at least one Seattle-area match. The address field is active and responsive.
5. Click a result → the pin drops on the map within Seattle.

- [ ] **Step 4: Live smoke — "Capitol Hill" resolves in Seattle, not DC**

1. Clear the search box.
2. Type `Capitol Hill`.
3. Wait ~300 ms or press Enter.
4. Confirm: the result list contains a Seattle-area result (coordinates near 47.6, -122.3).
5. Confirm: no Washington D.C. Capitol Hill result appears (coordinates would be near 38.8, -77.0).

- [ ] **Step 5: Live smoke — non-Seattle query returns empty**

1. Clear the search box.
2. Type `Times Square New York`.
3. Wait ~300 ms or press Enter.
4. Confirm: the results list is empty and the "No matches. Drop a pin on the map instead." message appears.

- [ ] **Step 6: Live smoke — recent places history**

1. Search for a Seattle address and click a result to select it (Places tab).
2. Clear the query field and click into the search box.
3. Confirm: the recent list appears showing the place just selected.
4. Switch to the **Routes** tab.
5. Confirm: the recently selected place appears as a From/To option (when no active search is running).

- [ ] **Step 7: Live smoke — Routes tab error/empty copy**

1. In the Routes tab address field, type a clearly non-Seattle query (`Times Square`).
2. Press the Search button.
3. Confirm: the alert area reads "No matches. Drop a pin on the map instead."

- [ ] **Step 8: Open the PR**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/address-search-polish" && git push -u origin address-search-polish
gh pr create \
  --title "feat(frontend): address-search polish — debounce, abort, empty status, recent places, Seattle bbox guard" \
  --body "$(cat <<'EOF'
## Summary

- Debounced type-ahead (~300 ms) with stale-request abort via AbortController in \`useAddressSearch\`
- First-class \`empty\` status; shared \`SEARCH_EMPTY_MSG\`/\`SEARCH_ERROR_MSG\` constants across PlaceSearch + RoutesTab
- Client-side Seattle-bbox guard (\`withinSeattleBbox\` in \`geocoding.ts\`) — defense-in-depth over the backend region-lock
- Recent-places history (\`searchHistory.ts\`) — localStorage, cap 5, dedup, most-recent-first; surfaced in both consumers
- \`PlaceSearch\` shows recent list on focus-while-empty; \`RoutesTab\` shows recent options when no geo search is active
- Phase 4 · H3 ticked in \`docs/ROADMAP.md\`

Spec: \`docs/superpowers/specs/2026-06-29-address-search-polish-design.md\`

## Test plan

- [ ] \`make test-all\` passes (pytest + ruff + vitest + build)
- [ ] Seattle address → results appear via debounce
- [ ] "Capitol Hill" → Seattle (not DC)
- [ ] "Times Square New York" → empty message
- [ ] Recent list appears on focus-empty in PlaceSearch
- [ ] Recent options appear in RoutesTab From/To when no search active

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:**
- Type-ahead debounce ~300 ms: Task 4 ✓
- Stale-request abort / AbortController: Task 4 ✓
- Blank query → idle, no network call: Task 4 ✓
- `empty` status (0 results): Task 3 ✓
- Shared `SEARCH_EMPTY_MSG` / `SEARCH_ERROR_MSG`: Task 3 ✓
- `DEBOUNCE_MS` exported constant: Task 4 ✓
- `searchHistory.ts` — `loadRecentPlaces`, `addRecentPlace`, key `waypoint.search.recent`, cap 5, dedup, most-recent-first, try/catch: Task 1 ✓
- Seattle bbox guard — `SEATTLE_BBOX`, `withinSeattleBbox`, filter in provider: Task 2 ✓
- `useAddressSearch` gains `recent` + `rememberPlace`: Task 5 ✓
- `PlaceSearch` recent list on focus-empty, `onMouseDown` trick, shared copy: Task 6 ✓
- `RoutesTab` recent options when no active search, dedup, `rememberPlace` on select, shared copy: Task 7 ✓
- `mapWorkspace.css` — `.mc-recent*` neutral styles: Task 8 ✓
- `docs/ROADMAP.md` Phase 4 H3 tick: Task 9 ✓
- Live smoke (Seattle, Capitol Hill → Seattle, Times Square → empty): Task 10 ✓
- `make test-all` gate: Task 10 ✓
- No backend changes: confirmed — all tasks are frontend-only ✓
- Product invariant: no safety language anywhere in the plan ✓

**Placeholder scan:** No "TBD", "TODO", "similar to above", "add appropriate handling" — every code block shows the complete file content.

**Type/name consistency:**
- `rememberPlace` — used in Tasks 5, 6, 7 ✓
- `recent` — used in Tasks 5, 6, 7 ✓
- `SEARCH_EMPTY_MSG` — defined Task 3, referenced Tasks 3, 4, 5, 6, 7 ✓
- `SEARCH_ERROR_MSG` — defined Task 3, referenced Tasks 3, 4, 5, 6, 7 ✓
- `withinSeattleBbox` — defined Task 2, referenced Task 2 ✓
- `SEATTLE_BBOX` — defined Task 2, referenced Task 2 ✓
- `DEBOUNCE_MS` — defined Task 4, referenced Tasks 4, 5 ✓
- `loadRecentPlaces` — defined Task 1, used in Task 5 ✓
- `addRecentPlace` — defined Task 1, used in Task 5 ✓
- `AddressSearchStatus` union — `"idle" | "loading" | "done" | "empty" | "error"` consistent across Tasks 3, 4, 5 ✓
- `EndpointOption.geoResult` field — added in Task 7 `RoutesTab.tsx` and threaded through `EndpointChooser.onSelect` ✓
