import { describe, expect, it } from "vitest";

import { buildRerunArgs, followupChipsFor } from "./followupChips";
import type { AnalysisCardData } from "../types";

const settings = {
  radius_m: 250,
  analysis_start_date: "2026-01-01",
  analysis_end_date: "2026-07-19",
  offense_category: null,
  layer: "reported" as const,
};

function cardFrom(kind: "analyze" | "compare", overrides: Partial<AnalysisCardData["settings"]> = {}): AnalysisCardData {
  return {
    runId: "run-1",
    kind,
    placeIds: ["p1", "p2"],
    settings: { ...settings, ...overrides },
    comparison: null,
    neighborhood: null,
    incidents: null,
  };
}

describe("followupChipsFor", () => {
  it("offers the next radius up, a category narrow, and a layer switch", () => {
    const chips = followupChipsFor("analyze", settings, [250, 500, 1000]);
    expect(chips.map((c) => c.label)).toEqual([
      "Widen to 500 m",
      "Property only",
      "Check 911 calls",
    ]);
    expect(chips[0]).toMatchObject({
      command: "analyze_places",
      argsPatch: { radii_m: [500] },
      settingsPatch: { radius_m: 500 },
    });
    expect(chips[1].argsPatch).toEqual({ offense_category: "PROPERTY" });
    expect(chips[2].argsPatch).toEqual({ layer: "calls" });
  });

  it("tightens instead when already at the largest radius, and widens category when narrowed", () => {
    const chips = followupChipsFor(
      "compare",
      { ...settings, radius_m: 1000, offense_category: "PROPERTY" },
      [250, 500, 1000],
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Tighten to 500 m",
      "All categories",
      "Check 911 calls",
    ]);
    expect(chips[0].command).toBe("compare_places");
    expect(chips[0].argsPatch).toEqual({ radius_m: 500 });
    // The analyze/compare tool arg models (AnalyzePlacesArgs / ComparePlacesByNameArgs in
    // app/assistant/tools.py) don't understand the "ALL" sentinel — that only exists on
    // UpdateFiltersArgs. Clearing the category here means omitting it, so the patch carries
    // an explicit null for the Task 6 arg-builder to strip before the command is sent.
    expect(chips[1].argsPatch).toEqual({ offense_category: null });
  });

  it("offers police reports when on another layer", () => {
    const chips = followupChipsFor("analyze", { ...settings, layer: "calls" }, [250, 500]);
    expect(chips.find((chip) => chip.label === "Back to police reports")?.argsPatch).toEqual({ layer: "reported" });
    expect(chips.some((chip) => chip.label === "Property only")).toBe(false);
  });
});

describe("buildRerunArgs", () => {
  it("drops offense_category entirely for the 'All categories' chip on a PROPERTY-filtered card", () => {
    const card = cardFrom("analyze", { offense_category: "PROPERTY" });
    const chips = followupChipsFor(card.kind, card.settings, [250, 500, 1000]);
    const allCategories = chips.find((c) => c.label === "All categories");
    expect(allCategories).toBeDefined();
    const args = buildRerunArgs(card, allCategories!);
    expect(args).not.toHaveProperty("offense_category");
    // The rest of the frozen scope survives.
    expect(args).toMatchObject({ place_ids: ["p1", "p2"], radii_m: [250], layer: "reported" });
  });

  it("carries the frozen offense_category through when the chip does not touch it", () => {
    const card = cardFrom("analyze", { offense_category: "PROPERTY" });
    const chips = followupChipsFor(card.kind, card.settings, [250, 500, 1000]);
    const radiusChip = chips.find((c) => c.label.startsWith("Widen"));
    const args = buildRerunArgs(card, radiusChip!);
    expect(args.offense_category).toBe("PROPERTY");
  });

  it("overrides the frozen radius in the analyze arg shape (radii_m list)", () => {
    const card = cardFrom("analyze");
    const chips = followupChipsFor(card.kind, card.settings, [250, 500, 1000]);
    const widen = chips.find((c) => c.label === "Widen to 500 m")!;
    const args = buildRerunArgs(card, widen);
    expect(args.radii_m).toEqual([500]);
    expect(args).not.toHaveProperty("radius_m");
  });

  it("overrides the frozen radius in the compare arg shape (single radius_m)", () => {
    const card = cardFrom("compare");
    const chips = followupChipsFor(card.kind, card.settings, [250, 500, 1000]);
    const widen = chips.find((c) => c.label === "Widen to 500 m")!;
    const args = buildRerunArgs(card, widen);
    expect(args.radius_m).toBe(500);
    expect(args).not.toHaveProperty("radii_m");
  });

  it("ignores a chip's full-args override — that's consumed by the handler, not the builder", () => {
    const card = cardFrom("analyze");
    const chips = followupChipsFor(card.kind, card.settings, [250, 500, 1000]);
    const widen = chips.find((c) => c.label === "Widen to 500 m")!;
    // A place-added offer chip would carry `args`; buildRerunArgs must still derive from the
    // card + argsPatch (the override is applied in handleFollowupChip, not here).
    const withOverride = { ...widen, args: { place_ids: ["zzz"], radii_m: [9999] } };
    const args = buildRerunArgs(card, withOverride);
    expect(args.place_ids).toEqual(["p1", "p2"]);
    expect(args.radii_m).toEqual([500]);
  });

  it("takes the analysis window from the card, never from anything live", () => {
    const card = cardFrom("analyze", { analysis_start_date: "2025-03-04", analysis_end_date: "2025-09-09" });
    const chips = followupChipsFor(card.kind, card.settings, [250, 500]);
    const layerChip = chips.find((c) => c.label === "Check 911 calls")!;
    const args = buildRerunArgs(card, layerChip);
    expect(args.analysis_start_date).toBe("2025-03-04");
    expect(args.analysis_end_date).toBe("2025-09-09");
    expect(args.layer).toBe("calls");
  });
});
