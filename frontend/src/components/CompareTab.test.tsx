// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { AnalysisSettings, Place, SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";

const home: Place = { id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5, total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal" };
const office: Place = { ...home, id: "p2", display_label: "Office" };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY", layer: "reported" };

function opt(id: string, label: string, count: number, rate: number): SiteComparisonOption {
  return { id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate };
}
function pair(a: string, b: string, decision: SiteDecisionClass, winner: string | null): SitePairwiseResult {
  return { id: `${a}-${b}`, option_a_id: a, option_a_label: a, option_b_id: b, option_b_label: b, winner_option_id: winner, winner_label: winner, decision_class: decision, method: "quasipoisson", incident_count_a: 0, incident_count_b: 0, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days", rate_a: 0, rate_b: 0, rate_ratio: 2.6, ci_lower: 1.4, ci_upper: 4.9, p_value: 0.001, adjusted_p_value: 0.004, overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "" };
}
function comparison(overall: SiteDecisionClass, options: SiteComparisonOption[], pairwise: SitePairwiseResult[]): SiteComparison {
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
    offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: overall, recommendation_option_id: null, recommendation_label: null, summary_text: "", caveat_text: "cav", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options, pairwise_results: pairwise },
  };
}
const clearSweep = comparison("statistically_lower", [opt("p1", "Home", 12, 3.9), opt("p2", "Office", 44, 14.3)], [pair("p1", "p2", "statistically_lower", "p1")]);

afterEach(cleanup);

describe("CompareTab", () => {
  it("prompts to select two places when fewer are chosen", () => {
    render(<CompareTab selected={[home]} analysis={analysis} comparison={null} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/select at least two places/i)).toBeInTheDocument();
  });

  it("before running: invites a compare and fires onRun", () => {
    const onRun = vi.fn();
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={null} running={false} onRun={onRun} />);
    expect(screen.getByText(/rank their reported incident rates/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("clear sweep: ranks lowest-first with the statistically-lower callout", () => {
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={clearSweep} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower than every other/i)).toBeInTheDocument();
    const ranked = screen.getByTestId("compare-ranked");
    expect(within(ranked).getByText("Home")).toBeInTheDocument();
    expect(within(ranked).getByText("lowest rate")).toBeInTheDocument();
    expect(within(ranked).getByText("clearly higher")).toBeInTheDocument();
    expect(screen.getByText(/reported incident context, not a personal risk prediction/i)).toBeInTheDocument();
  });

  it("no clear difference: muted callout, all similar", () => {
    const none = comparison("not_statistically_clear", [opt("p1", "Home", 18, 5.8), opt("p2", "Office", 22, 7.1)], [pair("p1", "p2", "not_statistically_clear", null)]);
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={none} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/no statistically clear difference/i)).toBeInTheDocument();
  });

  it("the dynamic verdict region never emits safety-ranking vocabulary", () => {
    render(<CompareTab selected={[home, office]} analysis={analysis} comparison={clearSweep} running={false} onRun={vi.fn()} />);
    const dynamic = `${screen.getByTestId("compare-callout").textContent ?? ""} ${screen.getByTestId("compare-ranked").textContent ?? ""}`.toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(dynamic).not.toContain(banned);
    }
  });

  it("keeps the compare action in the sticky actions bar", () => {
    const { container } = render(<CompareTab selected={[home, office]} analysis={analysis} comparison={null} running={false} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-compare-actions")).toBeInTheDocument();
  });
});
