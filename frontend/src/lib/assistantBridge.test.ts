import { describe, expect, it } from "vitest";
import { interpretToolResult } from "./assistantBridge";

describe("interpretToolResult", () => {
  it("maps compare_places to a replace-selection + compare effect, no view switch", () => {
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
        neighborhood: { radius_m: 500, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 500 },
      },
    });
    expect(effect).toEqual({
      selection: { mode: "replace", ids: ["a", "b"] },
      settings: { radiusM: 500, startDate: "2026-01-01", endDate: "2026-06-30", offenseCategory: "PROPERTY" },
      comparison: { overview: { summary_text: "more incidents at a" } },
      neighborhood: { radius_m: 500, places: [], pairwise: [] },
      incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 500 },
      refetchSummary: true,
      card: {
        runId: null,
        kind: "compare",
        placeIds: ["a", "b"],
        settings: {
          radius_m: 500,
          analysis_start_date: "2026-01-01",
          analysis_end_date: "2026-06-30",
          offense_category: "PROPERTY",
        },
        comparison: { overview: { summary_text: "more incidents at a" } },
        neighborhood: { radius_m: 500, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 500 },
      },
    });
  });

  it("maps analyze_places to neighborhood + incidents, no view switch", () => {
    const effect = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        neighborhood: { radius_m: 250, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 },
      },
    });
    expect(effect).not.toHaveProperty("tab");
    expect(effect?.selection).toEqual({ mode: "replace", ids: ["a"] });
    expect(effect?.settings?.radiusM).toBe(250);
    expect(effect?.settings?.offenseCategory).toBe("");
    expect(effect?.neighborhood).toEqual({ radius_m: 250, places: [], pairwise: [] });
    expect(effect?.refetchSummary).toBe(true);
    expect(effect?.card).toEqual({
      runId: null,
      kind: "analyze",
      placeIds: ["a"],
      settings: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
      comparison: null,
      neighborhood: { radius_m: 250, places: [], pairwise: [] },
      incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 },
    });
  });

  it("carries a string analysis_run_id through as card.runId", () => {
    const effect = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        neighborhood: { radius_m: 250, places: [], pairwise: [] },
        incidents: { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 },
        analysis_run_id: "run-123",
      },
    });
    expect(effect?.card?.runId).toBe("run-123");
  });

  it("yields card.runId: null when analysis_run_id is missing or not a string", () => {
    const effect = interpretToolResult({
      tool_name: "compare_places",
      result: {
        place_ids: ["a", "b"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        comparison: null,
        analysis_run_id: null,
      },
    });
    expect(effect?.card?.runId).toBeNull();
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

  it("surfaces compare_places badges verbatim on the effect when present", () => {
    const badges = [
      { place_id: "a", label: "Home", run_id: "run-1", settings_fingerprint: "abc123def456" },
      { place_id: "b", label: "Work", run_id: "run-1", settings_fingerprint: "abc123def456" },
    ];
    const effect = interpretToolResult({
      tool_name: "compare_places",
      result: {
        place_ids: ["a", "b"],
        settings_used: { radius_m: 500, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        comparison: null,
        badges,
      },
    });
    expect(effect?.badges).toEqual(badges);
  });

  it("surfaces analyze_places badges verbatim on the effect when present", () => {
    const badges = [{ place_id: "a", label: "Home", run_id: "run-1", settings_fingerprint: "abc123def456" }];
    const effect = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        neighborhood: null,
        incidents: null,
        badges,
      },
    });
    expect(effect?.badges).toEqual(badges);
  });

  it("omits badges from the effect when missing or not an array", () => {
    const missing = interpretToolResult({
      tool_name: "compare_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 500, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        comparison: null,
      },
    });
    expect(missing).not.toHaveProperty("badges");

    const malformed = interpretToolResult({
      tool_name: "analyze_places",
      result: {
        place_ids: ["a"],
        settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
        neighborhood: null,
        incidents: null,
        badges: "nope",
      },
    });
    expect(malformed).not.toHaveProperty("badges");
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

  it("maps update_filters patches to a settings effect with no view switch", () => {
    const effect = interpretToolResult({
      tool_name: "update_filters",
      result: { patch: { radius_m: 500, offense_category: null, layer: "arrests" } },
    });
    expect(effect).toEqual({ settings: { radiusM: 500, offenseCategory: "", layer: "arrests" } });
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
