import { describe, expect, it } from "vitest";
import { interpretToolResult } from "./assistantBridge";

describe("interpretToolResult", () => {
  it("maps compare_places to a replace-selection + compare effect on the Compare tab", () => {
    const effect = interpretToolResult({
      tool_name: "compare_places",
      result: {
        place_ids: ["a", "b"],
        settings_used: {
          radius_m: 500,
          analysis_start_date: "2026-01-01",
          analysis_end_date: "2026-06-30",
          offense_category: "PROPERTY",
        },
        comparison: { overview: { summary_text: "more incidents at a" } },
      },
    });
    expect(effect).toEqual({
      selection: { mode: "replace", ids: ["a", "b"] },
      settings: { radiusM: 500, startDate: "2026-01-01", endDate: "2026-06-30", offenseCategory: "PROPERTY" },
      comparison: { overview: { summary_text: "more incidents at a" } },
      refetchSummary: true,
      tab: "compare",
    });
  });

  it("maps analyze_places to neighborhood + incidents on the Compare tab", () => {
    const effect = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        neighborhood: { radius_m: 250, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 },
      },
    });
    expect(effect?.tab).toBe("compare");
    expect(effect?.selection).toEqual({ mode: "replace", ids: ["a"] });
    expect(effect?.settings?.radiusM).toBe(250);
    expect(effect?.settings?.offenseCategory).toBe("");
    expect(effect?.neighborhood).toEqual({ radius_m: 250, places: [], pairwise: [] });
    expect(effect?.refetchSummary).toBe(true);
  });

  it("reflects the arrests layer from settings_used into effect.settings.layer", () => {
    const effect = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: {
          radius_m: 250,
          analysis_start_date: "2026-01-01",
          analysis_end_date: "2026-06-30",
          offense_category: null,
          layer: "arrests",
        },
        neighborhood: { radius_m: 250, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 },
      },
    });
    expect(effect?.settings?.layer).toBe("arrests");
  });

  it("maps add_place to an append-selection effect", () => {
    const effect = interpretToolResult({
      tool_name: "add_place",
      result: { place: { id: "new-1" }, created: true, address: "somewhere" },
    });
    expect(effect).toEqual({ selection: { mode: "add", ids: ["new-1"] }, refetchSummary: true });
  });

  it("maps select_places, honoring mode", () => {
    expect(interpretToolResult({ tool_name: "select_places", result: { place_ids: [], mode: "clear" } }))
      .toEqual({ selection: { mode: "clear", ids: [] } });
  });

  it("returns null when add_place result lacks a place id", () => {
    expect(interpretToolResult({ tool_name: "add_place", result: {} })).toBeNull();
    expect(interpretToolResult({ tool_name: "add_place", result: { place: {} } })).toBeNull();
  });

  it("returns null for read-only or unknown tools", () => {
    expect(interpretToolResult({ tool_name: "get_dashboard_summary", result: {} })).toBeNull();
    expect(interpretToolResult({ tool_name: "mystery", result: {} })).toBeNull();
  });
});
