// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisCard, categoryCounts } from "./AnalysisCard";
import type {
  AnalysisCardData,
  BaselineEntry,
  IncidentDetail,
  IncidentDetailsResponse,
  NeighborhoodAnalysis,
  NeighborhoodPlace,
  SiteComparison,
  SiteComparisonOption,
  SiteDecisionClass,
  SitePairwiseResult,
  TrendsResponse,
} from "../types";

const getTrends = vi.fn();
vi.mock("../api/client", () => ({
  getTrends: (...args: unknown[]) => getTrends(...args),
}));

// --- SiteComparison fixtures (copied from lib/compareVerdict.test.ts) ---
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

// --- Neighborhood fixtures (copied from components/TrendSection.test.tsx) ---
function mcppBaseline(label: string): BaselineEntry {
  return { kind: "mcpp", label, area_km2: 2.1, baseline_incident_count: 500, baseline_rate: 0.2, rate_ratio: 1.0, ci_lower: 0.8, ci_upper: 1.3, adjusted_p_value: 0.5, method: "quasi_poisson", relation: "similar" };
}
function placeWithMcpp(id: string, label: string): NeighborhoodPlace {
  return { place_id: id, place_label: id, beat: "M2", radius_m: 250, baseline_available: true, decision: "not_clear", place_incident_count: 3, baselines: [mcppBaseline(label)], category_breakdown: [] };
}
function neighborhood(...labels: string[]): NeighborhoodAnalysis {
  return { radius_m: 250, analysis_start_date: "2021-07-01", analysis_end_date: "2026-06-30", offense_category: null, pairwise: [], places: labels.map((l, i) => placeWithMcpp(`n${i}`, l)) };
}
function months(n: number): string[] {
  const out: string[] = [];
  let y = 2021;
  let m = 7;
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
function trends(over: Partial<TrendsResponse> = {}): TrendsResponse {
  const ms = over.months ?? months(60);
  return { layer: "reported", mcpp: "TEST HILL", mcpp_label: "Test Hill", category: null, months: ms, area_counts: ms.map((_, i) => 10 + (i % 5)), citywide_counts: ms.map((_, i) => 900 + (i % 7)), ...over };
}

// --- IncidentDetails fixture ---
function incident(category: string | null, id: string): IncidentDetail {
  return { place_id: "p1", place_label: "Home", incident_id: id, external_incident_id: null, report_number: id, occurred_at: "2026-03-02T14:30:00", reported_at: null, offense_category: category, offense_subcategory: null, nibrs_group: null, block_address: "1 MAIN ST", distance_m: 40 };
}
function incidents(): IncidentDetailsResponse {
  return { incidents: [incident("PROPERTY", "i1"), incident("PROPERTY", "i2"), incident("PERSON", "i3")], returned_count: 3, total_count: 3, limit: 200, radius_m: 250 };
}

function analyzeCard(over: Partial<AnalysisCardData> = {}): AnalysisCardData {
  return {
    runId: "run-1",
    kind: "analyze",
    placeIds: ["p1"],
    settings: { radius_m: 250, analysis_start_date: "2021-07-01", analysis_end_date: "2026-06-30", offense_category: null, layer: "reported" },
    comparison: null,
    neighborhood: neighborhood("Test Hill"),
    incidents: incidents(),
    ...over,
  };
}
function compareCard(over: Partial<AnalysisCardData> = {}): AnalysisCardData {
  return {
    runId: "run-2",
    kind: "compare",
    placeIds: ["a", "b"],
    settings: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-12-31", offense_category: null, layer: "reported" },
    comparison: comparison("statistically_lower", [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 31, 10.1)], [pair("a", "b", "statistically_lower", "a", 2.6)], "a"),
    neighborhood: null,
    incidents: null,
    ...over,
  };
}

const EXPORT_BASE = "/exports/tableau/place-summary.csv";

beforeEach(() => {
  getTrends.mockReset().mockResolvedValue(trends());
});
afterEach(cleanup);

describe("categoryCounts", () => {
  it("aggregates incidents by category label (descending) and returns [] when empty", () => {
    expect(categoryCounts(null)).toEqual([]);
    expect(categoryCounts({ incidents: [], returned_count: 0, total_count: 0, limit: 200, radius_m: 250 })).toEqual([]);
    expect(categoryCounts(incidents())).toEqual([
      { label: "Property", count: 2 },
      { label: "Person", count: 1 },
    ]);
  });

  it("buckets null categories as Uncategorized, matching the incident table", () => {
    const details: IncidentDetailsResponse = { incidents: [incident(null, "i1"), incident(null, "i2"), incident("PROPERTY", "i3")], returned_count: 3, total_count: 3, limit: 200, radius_m: 250 };
    expect(categoryCounts(details)).toEqual([
      { label: "Uncategorized", count: 2 },
      { label: "Property", count: 1 },
    ]);
  });
});

describe("AnalysisCard", () => {
  it("labels a frozen card that no longer matches the live scope as previous analysis", () => {
    const { container } = render(
      <AnalysisCard card={analyzeCard()} expanded={false} historical onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />,
    );
    expect(screen.getByText("Previous analysis")).toBeInTheDocument();
    expect(container.querySelector(".mc-result-card")).toHaveClass("is-historical");
  });

  it("compact analyze card is a result summary without duplicated filters or analysis prose", () => {
    render(<AnalysisCard card={analyzeCard()} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.getByRole("heading", { name: "n0" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("reported incidents")).toBeInTheDocument();
    expect(screen.queryByText(/2021-07-01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/250 m/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reported incident rate is/)).not.toBeInTheDocument();
    // compact: no trend/incident/methods sections
    expect(screen.queryByTestId("trend-section")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/near selected places/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Methods/ })).not.toBeInTheDocument();
  });

  it("compact compare card renders the CompareVerdict callout", () => {
    render(<AnalysisCard card={compareCard()} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.getByText("Comparison")).toBeInTheDocument();
    const callout = screen.getByTestId("compare-callout");
    expect(callout).toHaveTextContent("Pike");
    expect(callout).toHaveTextContent(/lowest/);
  });

  it("renders comparison, neighborhood trends, and incident details together when expanded", async () => {
    render(
      <AnalysisCard
        card={compareCard({ neighborhood: neighborhood("Test Hill", "North"), incidents: incidents() })}
        expanded
        onExpandChange={() => {}}
        exportHrefBase={EXPORT_BASE}
      />,
    );
    expect(screen.getAllByText("Pike").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/reported incident rate is/)).toHaveLength(2);
    expect(await screen.findByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.getByLabelText(/near selected places/)).toBeInTheDocument();
  });

  it("renders a run-scoped export link when runId is set and omits it when null", () => {
    render(<AnalysisCard card={analyzeCard({ runId: "run-9" })} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", `${EXPORT_BASE}?run_id=run-9`);
    cleanup();
    render(<AnalysisCard card={analyzeCard({ runId: null })} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("toggles expansion and renders MethodsAppendix + incident-details when expanded", () => {
    const onExpandChange = vi.fn();
    const { rerender } = render(<AnalysisCard card={analyzeCard()} expanded={false} onExpandChange={onExpandChange} exportHrefBase={EXPORT_BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /view details/i }));
    expect(onExpandChange).toHaveBeenCalledWith(true);

    rerender(<AnalysisCard card={analyzeCard()} expanded onExpandChange={onExpandChange} exportHrefBase={EXPORT_BASE} />);
    expect(screen.getByRole("button", { name: /Methods/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/near selected places/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(onExpandChange).toHaveBeenCalledWith(false);
  });

  it("shows the product caveat above the methods appendix only when expanded", () => {
    render(<AnalysisCard card={analyzeCard()} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.queryByText(/not a personal risk prediction/)).not.toBeInTheDocument();
    cleanup();

    render(<AnalysisCard card={analyzeCard()} expanded onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.getByText(/not a personal risk prediction/)).toBeInTheDocument();
  });

  it("skips the category mini-bars on the calls layer (911 calls carry no category)", () => {
    const card = analyzeCard({
      settings: { radius_m: 250, analysis_start_date: "2021-07-01", analysis_end_date: "2026-06-30", offense_category: null, layer: "calls" },
      incidents: { incidents: [incident(null, "i1"), incident(null, "i2")], returned_count: 2, total_count: 2, limit: 200, radius_m: 250 },
    });
    const { container } = render(<AnalysisCard card={card} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(container.querySelector(".mc-result-minibar")).not.toBeInTheDocument();
    expect(screen.queryByText("Uncategorized")).not.toBeInTheDocument();
  });

  it("notes when the mini-bars cover only the returned subset of a capped list", () => {
    const capped = analyzeCard({
      incidents: { ...incidents(), returned_count: 3, total_count: 12 },
    });
    render(<AnalysisCard card={capped} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.getByText("of the 3 nearest")).toBeInTheDocument();
    cleanup();
    // uncapped: no note
    render(<AnalysisCard card={analyzeCard()} expanded={false} onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    expect(screen.queryByText(/of the \d+ nearest/)).not.toBeInTheDocument();
  });

  it("passes the frozen layer and category to the trends fetch when expanded", async () => {
    const card = analyzeCard({
      settings: { radius_m: 250, analysis_start_date: "2021-07-01", analysis_end_date: "2026-06-30", offense_category: "PROPERTY", layer: "calls" },
    });
    render(<AnalysisCard card={card} expanded onExpandChange={() => {}} exportHrefBase={EXPORT_BASE} />);
    await screen.findByTestId("trend-chart");
    expect(getTrends).toHaveBeenCalled();
    const [params] = getTrends.mock.calls[0];
    expect(params.layer).toBe("calls");
    expect(params.category).toBe("PROPERTY");
  });
});
