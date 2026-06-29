// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ createRouteAlternatives: vi.fn() }));

import { useRoutes } from "./useRoutes";
import { createRouteAlternatives } from "../api/client";
import type { AnalysisSettings, RouteComparison } from "../types";

const analysis: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  radiusM: 250,
  offenseCategory: "",
};

function comparison(): RouteComparison {
  return {
    request: { id: "r1", origin: { label: "A" }, destination: { label: "B" }, mode: "transit" },
    alternatives: [
      {
        id: "alt-1", route_label: "Route 1", rank: 1, duration_minutes: 10, distance_m: 1000,
        transfer_count: 0, walking_distance_m: null, mode_mix: "transit",
        summary_geometry: "47.61,-122.34;47.62,-122.33",
      },
      {
        id: "alt-2", route_label: "Route 2", rank: 2, duration_minutes: 12, distance_m: 1200,
        transfer_count: 1, walking_distance_m: null, mode_mix: "transit",
        summary_geometry: null,
      },
    ],
    context_summaries: [],
    statistical_comparison: {
      overview: {
        decision_class: "statistically_lower",
        recommendation_option_id: "alt-1",
        recommendation_label: "Route 1",
        summary_text: "",
        caveat_text: "",
      },
    },
  };
}

describe("useRoutes", () => {
  it("runs a comparison and derives map lines only for alternatives with geometry", async () => {
    vi.mocked(createRouteAlternatives).mockResolvedValue(comparison());
    const { result } = renderHook(() => useRoutes(analysis));

    await act(async () => {
      await result.current.runRoute({ place_id: "p1" }, { place_id: "p2" }, "transit");
    });

    expect(createRouteAlternatives).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "transit",
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-30",
        radii_m: [250],
      }),
    );
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBe("");
    // alt-1 has a 2-point geometry (kept, and it is the recommendation); alt-2 has none.
    expect(result.current.routeLines).toHaveLength(1);
    expect(result.current.routeLines[0]).toMatchObject({ id: "alt-1", recommended: true });
    expect(result.current.routeLines[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces an error and keeps no result when the request fails", async () => {
    vi.mocked(createRouteAlternatives).mockRejectedValue(new Error("router down"));
    const { result } = renderHook(() => useRoutes(analysis));

    await act(async () => {
      await result.current.runRoute({ place_id: "p1" }, { place_id: "p2" }, "transit");
    });

    expect(result.current.error).toBe("router down");
    expect(result.current.result).toBeNull();
    expect(result.current.routeLines).toEqual([]);
  });
});
