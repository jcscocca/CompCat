// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIncidentPoints } from "./useIncidentPoints";
import type { AnalysisSettings, IncidentPointsResponse, MapBounds } from "../types";

const fetchPoints = vi.fn();

vi.mock("../api/client", () => ({
  getIncidentPoints: (...args: unknown[]) => fetchPoints(...args),
}));

const BOUNDS: MapBounds = { west: -122.4, south: 47.55, east: -122.25, north: 47.65 };
const ANALYSIS: AnalysisSettings = {
  startDate: "2025-01-01",
  endDate: "2025-10-31",
  radiusM: 250,
  offenseCategory: "",
  layer: "reported",
};

function response(over: Partial<IncidentPointsResponse> = {}): IncidentPointsResponse {
  return {
    points: [
      {
        id: "inc-1", latitude: 47.61, longitude: -122.33,
        offense_category: "PROPERTY", offense_subcategory: "THEFT",
        occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST",
        source_dataset: "seattle_spd_crime",
      },
    ],
    returned_count: 1, total_count: 1, unmappable_citywide_count: 2, limit: 5000,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchPoints.mockReset().mockResolvedValue(response());
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("useIncidentPoints", () => {
  it("does not fetch until bounds arrive, then fetches after the debounce", async () => {
    const { result, rerender } = renderHook(
      ({ bounds }) => useIncidentPoints({ bounds, analysis: ANALYSIS }),
      { initialProps: { bounds: null as MapBounds | null } },
    );
    expect(fetchPoints).not.toHaveBeenCalled();
    rerender({ bounds: BOUNDS });
    expect(fetchPoints).not.toHaveBeenCalled(); // still inside debounce window
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchPoints).toHaveBeenCalledTimes(1);
    expect(fetchPoints.mock.calls[0][0]).toMatchObject({
      bounds: BOUNDS,
      analysis_start_date: "2025-01-01",
      layer: "reported",
    });
    expect(result.current.geojson.features).toHaveLength(1);
    expect(result.current.geojson.features[0].geometry.coordinates).toEqual([-122.33, 47.61]);
    expect(result.current.unmappableCitywideCount).toBe(2);
  });

  it("collapses rapid viewport changes into one trailing fetch", async () => {
    const { rerender } = renderHook(
      ({ bounds }) => useIncidentPoints({ bounds, analysis: ANALYSIS }),
      { initialProps: { bounds: BOUNDS } },
    );
    rerender({ bounds: { ...BOUNDS, north: 47.66 } });
    rerender({ bounds: { ...BOUNDS, north: 47.67 } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchPoints).toHaveBeenCalledTimes(1);
    expect(fetchPoints.mock.calls[0][0].bounds.north).toBe(47.67);
  });

  it("refetches when the layer changes", async () => {
    const { rerender } = renderHook(
      ({ analysis }) => useIncidentPoints({ bounds: BOUNDS, analysis }),
      { initialProps: { analysis: ANALYSIS } },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender({ analysis: { ...ANALYSIS, layer: "arrests" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchPoints).toHaveBeenCalledTimes(2);
    expect(fetchPoints.mock.calls[1][0].layer).toBe("arrests");
  });

  it("ignores results from aborted requests", async () => {
    let rejectFirst: () => void = () => {};
    fetchPoints
      .mockImplementationOnce(
        (_payload, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            rejectFirst = () => reject(new DOMException("aborted", "AbortError"));
            signal?.addEventListener("abort", rejectFirst);
          }),
      )
      .mockResolvedValueOnce(response({ unmappable_citywide_count: 9 }));
    const { result, rerender } = renderHook(
      ({ bounds }) => useIncidentPoints({ bounds, analysis: ANALYSIS }),
      { initialProps: { bounds: BOUNDS } },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender({ bounds: { ...BOUNDS, north: 47.7 } }); // aborts request #1
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.unmappableCitywideCount).toBe(9);
    expect(result.current.error).toBeNull();
  });
});
