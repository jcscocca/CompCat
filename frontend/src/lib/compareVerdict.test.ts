// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toCompareVerdict } from "./compareVerdict";
import type { SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";

function opt(id: string, label: string, count: number, rate: number): SiteComparisonOption {
  return { id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate };
}

function pair(a: string, b: string, decision: SiteDecisionClass, winner: string | null, ratio: number): SitePairwiseResult {
  return {
    id: `${a}-${b}`, option_a_id: a, option_a_label: a, option_b_id: b, option_b_label: b,
    winner_option_id: winner, winner_label: winner, decision_class: decision, method: "quasipoisson",
    incident_count_a: 0, incident_count_b: 0, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days",
    rate_a: 0, rate_b: 0, rate_ratio: ratio, ci_lower: ratio * 0.6, ci_upper: ratio * 1.4,
    p_value: 0.01, adjusted_p_value: 0.02, overdispersion_phi: 1.0, overdispersion_status: "ok",
    minimum_data_status: "met", caveat_text: "",
  };
}

function comparison(overall: SiteDecisionClass, options: SiteComparisonOption[], pairwise: SitePairwiseResult[], recId: string | null): SiteComparison {
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250,
    analysis_start_date: "2026-01-01", analysis_end_date: "2026-12-31",
    offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: overall, recommendation_option_id: recId, recommendation_label: recId, summary_text: "", caveat_text: "cav", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options, pairwise_results: pairwise },
  };
}

describe("toCompareVerdict", () => {
  it("ranks options ascending by rate with the lowest first and 1-based ranks", () => {
    const c = comparison("not_statistically_clear",
      [opt("b", "Bell", 31, 10.1), opt("a", "Pike", 12, 3.9), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "b", "not_statistically_clear", null, 2.6), pair("a", "y", "not_statistically_clear", null, 3.7)], null);
    const m = toCompareVerdict(c);
    expect(m.rows.map((r) => r.label)).toEqual(["Pike", "Bell", "Yesler"]);
    expect(m.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(m.rows[0].relationship).toBe("lowest");
    expect(m.rows[0].barFraction).toBeCloseTo(3.9 / 14.3, 5);
    expect(m.rows[2].barFraction).toBeCloseTo(1, 5);
    expect(m.rows[1].multipleOfLowest).toBeCloseTo(10.1 / 3.9, 4);
    expect(m.rows[0].multipleOfLowest).toBeNull();
  });

  it("clean sweep -> clear callout, others 'higher'", () => {
    const c = comparison("statistically_lower",
      [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 31, 10.1), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "b", "statistically_lower", "a", 2.6), pair("a", "y", "statistically_lower", "a", 3.7)], "a");
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("clear");
    expect(m.callout.lowestLabel).toBe("Pike");
    expect(m.callout.loweredCount).toBe(2);
    expect(m.callout.otherCount).toBe(2);
    expect(m.rows.filter((r) => r.relationship === "higher")).toHaveLength(2);
  });

  it("partial sweep -> partial callout with N of M and mixed chips", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 12, 3.9), opt("v", "Vine", 14, 4.4), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "v", "not_statistically_clear", null, 1.1), pair("a", "y", "statistically_lower", "a", 3.7)], null);
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("partial");
    expect(m.callout.loweredCount).toBe(1);
    expect(m.callout.otherCount).toBe(2);
    expect(m.rows.find((r) => r.label === "Vine")!.relationship).toBe("similar");
    expect(m.rows.find((r) => r.label === "Yesler")!.relationship).toBe("higher");
  });

  it("no pair clears -> none callout", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 18, 5.8), opt("b", "Bell", 22, 7.1)],
      [pair("a", "b", "not_statistically_clear", null, 1.2)], null);
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("none");
    expect(m.callout.loweredCount).toBe(0);
    expect(m.rows[1].relationship).toBe("similar");
  });

  it("insufficient/model_warning overall -> inconclusive with caveat, even if a pair cleared", () => {
    const c = comparison("insufficient_data",
      [opt("a", "Pike", 2, 0.6), opt("y", "Yesler", 44, 14.3)],
      [pair("a", "y", "statistically_lower", "a", 20)], null);
    const m = toCompareVerdict(c);
    expect(m.callout.kind).toBe("inconclusive");
    expect(m.callout.caveatText).toBe("full cav");
    expect(m.rows.find((r) => r.label === "Yesler")!.relationship).toBe("higher");
  });

  it("insufficient pair -> row relationship 'limited'", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 12, 3.9), opt("z", "Zed", 3, 9.0)],
      [pair("a", "z", "insufficient_data", null, 2.3)], null);
    const m = toCompareVerdict(c);
    expect(m.rows.find((r) => r.label === "Zed")!.relationship).toBe("limited");
  });

  it("zero lowest rate -> multipleOfLowest is null (no divide-by-zero)", () => {
    const c = comparison("not_statistically_clear",
      [opt("a", "Pike", 0, 0), opt("b", "Bell", 10, 4.0)],
      [pair("a", "b", "not_statistically_clear", null, 0)], null);
    const m = toCompareVerdict(c);
    expect(m.rows[1].multipleOfLowest).toBeNull();
  });
});
