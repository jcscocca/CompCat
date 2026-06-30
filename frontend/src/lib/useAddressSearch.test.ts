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
