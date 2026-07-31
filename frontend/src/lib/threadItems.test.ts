import { describe, expect, it } from "vitest";

import { latestResultContext, toApiMessages, type ThreadItem } from "./threadItems";

describe("toApiMessages", () => {
  it("maps user_text and tabby_text to chat roles in order", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "compare my places" },
      { kind: "tabby_text", text: "Here's the side-by-side." },
      { kind: "user_text", text: "evenings only" },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "compare my places" },
      { role: "assistant", content: "Here's the side-by-side." },
      { role: "user", content: "evenings only" },
    ]);
  });

  it("skips receipts and notices", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "hi" },
      { kind: "receipt", text: "Search radius → 500 m" },
      { kind: "notice", text: "Tabby can't reach the case files right now." },
      { kind: "tabby_text", text: "Hello." },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello." },
    ]);
  });

  it("returns an empty array for an empty thread", () => {
    expect(toApiMessages([])).toEqual([]);
  });

  it("skips analysis_card items", () => {
    const items: ThreadItem[] = [
      { kind: "user_text", text: "analyze Alpha" },
      {
        kind: "analysis_card",
        card: {
          runId: "run-1",
          kind: "analyze",
          placeIds: ["a"],
          settings: {},
          comparison: null,
          neighborhood: null,
          incidents: null,
        },
      },
      { kind: "tabby_text", text: "Here's Alpha." },
    ];
    expect(toApiMessages(items)).toEqual([
      { role: "user", content: "analyze Alpha" },
      { role: "assistant", content: "Here's Alpha." },
    ]);
  });
});

describe("latestResultContext", () => {
  it("returns only the newest saved-place card scope", () => {
    const items: ThreadItem[] = [
      {
        kind: "analysis_card",
        card: {
          runId: "old",
          kind: "analyze",
          placeIds: ["old-place"],
          settings: {
            radius_m: 250,
            analysis_start_date: "2024-01-01",
            analysis_end_date: "2024-06-30",
            offense_category: null,
            layer: "reported",
          },
          comparison: null,
          neighborhood: null,
          incidents: null,
        },
      },
      {
        kind: "analysis_card",
        card: {
          runId: "new",
          kind: "compare",
          placeIds: ["a", "b", "a"],
          settings: {
            radius_m: 500,
            analysis_start_date: "2025-01-01",
            analysis_end_date: "2025-12-31",
            offense_category: "PROPERTY",
            offense_subcategory: "THEFT",
            nibrs_group: "A",
            layer: "calls",
          },
          comparison: { raw: "must not be sent" } as never,
          neighborhood: { raw: "must not be sent" } as never,
          incidents: { incidents: [{ raw: "must not be sent" }] } as never,
        },
      },
    ];

    expect(latestResultContext(items)).toEqual({
      kind: "compare",
      place_ids: ["a", "b"],
      analysis_start_date: "2025-01-01",
      analysis_end_date: "2025-12-31",
      radius_m: 500,
      offense_category: "PROPERTY",
      offense_subcategory: "THEFT",
      nibrs_group: "A",
      layer: "calls",
    });
  });

  it("returns null for an ad-hoc or incomplete newest card", () => {
    const items: ThreadItem[] = [
      {
        kind: "analysis_card",
        card: {
          runId: null,
          kind: "analyze",
          placeIds: [],
          settings: {},
          comparison: null,
          neighborhood: null,
          incidents: null,
        },
      },
    ];

    expect(latestResultContext(items)).toBeNull();
  });

  it("returns bounded transient scope for a point-backed card", () => {
    const points = [
      { latitude: 47.61, longitude: -122.33, label: "Downtown" },
      { latitude: 47.62, longitude: -122.34, label: "Capitol Hill" },
    ];
    const items: ThreadItem[] = [{
      kind: "analysis_card",
      card: {
        runId: null,
        kind: "compare",
        placeIds: [],
        points,
        settings: {
          radius_m: 250,
          analysis_start_date: "2024-01-01",
          analysis_end_date: "2024-12-31",
          layer: "reported",
        },
        comparison: null,
        neighborhood: null,
        incidents: null,
      },
    }];

    expect(latestResultContext(items)).toEqual(expect.objectContaining({
      kind: "compare",
      place_ids: [],
      points,
    }));
  });
});
