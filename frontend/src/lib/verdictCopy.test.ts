import { describe, expect, it } from "vitest";

import { aggregateHeadline } from "./verdictCopy";
import { incidentNoun } from "./layerCopy";
import type { BaselineEntry, NeighborhoodPlace } from "../types";

const entry = (kind: BaselineEntry["kind"], label: string, relation: BaselineEntry["relation"]): BaselineEntry => ({
  kind, label, relation,
  area_km2: 1, baseline_incident_count: 10, baseline_rate: 0.02,
  rate_ratio: 1.4, ci_lower: 0.9, ci_upper: 2.2, adjusted_p_value: 0.2, method: "quasi_poisson",
});

const basePlace = (baselines: BaselineEntry[], overrides: Partial<NeighborhoodPlace> = {}): NeighborhoodPlace => ({
  place_id: "p1", place_label: "Cafe", beat: "C2", radius_m: 250,
  baseline_available: true, decision: "not_clear", place_incident_count: 12,
  category_breakdown: [], baselines, ...overrides,
});

describe("aggregateHeadline", () => {
  it("groups relations into one sentence in above/below/similar order", () => {
    const headline = aggregateHeadline(
      basePlace([
        entry("mcpp", "Capitol Hill", "similar"),
        entry("beat", "Beat C2", "similar"),
        entry("sector", "Sector C", "above"),
        entry("city", "Citywide", "above"),
      ]),
      incidentNoun("reported"),
    );
    expect(headline).toBe(
      "Cafe's reported incident rate is above its sector (C) and the citywide rate; similar to Capitol Hill and its beat (C2).",
    );
  });

  it("ignores insufficient entries in the sentence", () => {
    const headline = aggregateHeadline(
      basePlace([entry("city", "Citywide", "above"), entry("sector", "Sector C", "insufficient")]),
      incidentNoun("reported"),
    );
    expect(headline).toBe("Cafe's reported incident rate is above the citywide rate.");
  });

  it("explains the radius-too-large case", () => {
    const headline = aggregateHeadline(
      basePlace([], { minimum_data_status: "baseline_too_small", decision: "insufficient_data" }),
      incidentNoun("reported"),
    );
    expect(headline).toContain("smaller radius");
  });

  it("says when every comparison lacked data", () => {
    const headline = aggregateHeadline(
      basePlace([entry("city", "Citywide", "insufficient")], { decision: "insufficient_data" }),
      incidentNoun("reported"),
    );
    expect(headline).toBe("Not enough data to compare Cafe to its area baselines.");
  });

  it("says when no baseline geography resolved at all", () => {
    const headline = aggregateHeadline(
      basePlace([], { decision: "baseline_unavailable", baseline_available: false }),
      incidentNoun("reported"),
    );
    expect(headline).toBe("No area baseline available for Cafe.");
  });
});
