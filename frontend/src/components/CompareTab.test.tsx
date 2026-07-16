// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { GeocodingProvider } from "../lib/geocoding";
import type { AddressEntry } from "../lib/useCompareSet";
import { keyOf } from "../lib/useCompareSet";
import type { AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, NeighborhoodPlace, SiteComparison, SiteComparisonOption, SitePairwiseResult, SiteDecisionClass } from "../types";

const provider: GeocodingProvider = { search: vi.fn().mockResolvedValue([]) };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY", layer: "reported" };
const entriesOf = (...labels: string[]): AddressEntry[] => labels.map((l, i) => ({ latitude: 47.6 + i * 0.01, longitude: -122.3 - i * 0.01, label: l }));

function opt(id: string, label: string, count: number, rate: number): SiteComparisonOption {
  return { id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate };
}
function pair(a: string, b: string, decision: SiteDecisionClass, winner: string | null): SitePairwiseResult {
  return { id: `${a}-${b}`, option_a_id: a, option_a_label: a, option_b_id: b, option_b_label: b, winner_option_id: winner, winner_label: winner, decision_class: decision, method: "quasipoisson", incident_count_a: 0, incident_count_b: 0, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days", rate_a: 0, rate_b: 0, rate_ratio: 0.38, ci_lower: 0.2, ci_upper: 0.71, p_value: 0.001, adjusted_p_value: 0.004, overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "" };
}
const clearSweep: SiteComparison = {
  id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
  offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
  overview: { label: "Overview", decision_class: "statistically_lower", recommendation_option_id: "a", recommendation_label: "Pike", summary_text: "", caveat_text: "cav", options: [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 44, 14.3)] },
  analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options: [opt("a", "Pike", 12, 3.9), opt("b", "Bell", 44, 14.3)], pairwise_results: [pair("a", "b", "statistically_lower", "a")] },
};

function contextPlace(id: string, label: string, count: number): NeighborhoodPlace {
  return {
    place_id: id, place_label: label, beat: "M2", radius_m: 250,
    baseline_available: true, decision: "above_clear", place_incident_count: count,
    place_rate: 0.5, place_rate_ci_lower: 0.3, place_rate_ci_upper: 0.8,
    minimum_data_status: "met", nearest_incident_m: 42, monthly_counts: [1, 2, 3],
    baselines: [
      { kind: "beat", label: "Beat M2", area_km2: 1.1, baseline_incident_count: 180, baseline_rate: 0.17, rate_ratio: 2.0, ci_lower: 1.1, ci_upper: 3.6, adjusted_p_value: 0.012, method: "quasi_poisson", relation: "above" },
    ],
    category_breakdown: [{ label: "Theft", place_count: 3, place_share: 0.6, beat_share: 0.2 }],
    temporal: {
      hour_by_dow: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      hour_counts: Array.from({ length: 24 }, (_, h) => (h === 17 ? 5 : 0)),
      dow_counts: [5, 0, 0, 0, 0, 0, 0],
      total_with_time: 5,
      without_time: 0,
    },
  };
}
const twoPlaceNeighborhood: NeighborhoodAnalysis = {
  radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
  offense_category: null, pairwise: [], places: [contextPlace("n1", "Pike", 12), contextPlace("n2", "Bell", 44)],
};
const onePlaceNeighborhood: NeighborhoodAnalysis = { ...twoPlaceNeighborhood, places: [contextPlace("n1", "Pike", 12)] };
const incidents: IncidentDetailsResponse = {
  radius_m: 250, total_count: 2, returned_count: 2,
  incidents: [
    { place_id: "n1", place_label: "Pike", incident_id: "i1", external_incident_id: null, report_number: "R-1", occurred_at: "2026-03-01T10:00:00Z", reported_at: "2026-03-01T11:00:00Z", offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A", distance_m: 40, block_address: "500 BLOCK PIKE ST" },
    { place_id: "n2", place_label: "Bell", incident_id: "i2", external_incident_id: null, report_number: "R-2", occurred_at: "2026-03-02T10:00:00Z", reported_at: "2026-03-02T11:00:00Z", offense_category: "PERSON", offense_subcategory: "ASSAULT", nibrs_group: "A", distance_m: 60, block_address: "2200 BLOCK BELL ST" },
  ],
} as unknown as IncidentDetailsResponse;

afterEach(cleanup);

const base = {
  provider,
  onAddEntry: vi.fn(), onRemoveEntry: vi.fn(), onSaveEntry: vi.fn(),
  savedKeys: new Set<string>(),
  analysis, availableRadii: [250, 500], running: false,
  comparison: null as SiteComparison | null,
  neighborhood: null as NeighborhoodAnalysis | null,
  incidents: null as IncidentDetailsResponse | null,
  runPoints: null as AddressEntry[] | null,
  onChange: vi.fn(), onRun: vi.fn(),
};

describe("CompareTab (unified panel)", () => {
  it("empty list: invites adding an address; Run disabled", () => {
    render(<CompareTab {...base} entries={[]} />);
    expect(screen.getByText(/add at least one address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("one entry: CTA reads Run analysis and fires onRun", () => {
    const onRun = vi.fn();
    render(<CompareTab {...base} onRun={onRun} entries={entriesOf("Pike")} />);
    const cta = screen.getByRole("button", { name: /run analysis/i });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    expect(onRun).toHaveBeenCalled();
  });

  it("two entries: CTA adapts to Compare 2 addresses", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} />);
    expect(screen.getByRole("button", { name: /compare 2 addresses/i })).toBeInTheDocument();
  });

  it("querybar controls emit onChange patches", () => {
    const onChange = vi.fn();
    render(<CompareTab {...base} onChange={onChange} entries={entriesOf("Pike")} />);
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-02-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-02-01" });
  });

  it("N=1 result: renders the context module full-width (no spine)", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} incidents={incidents} />);
    expect(screen.getByLabelText("Context for Pike")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument();
  });

  it("renders every address's module full-width when the comparison is unavailable, without key warnings", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} />);
    expect(screen.getByLabelText("Context for Pike")).toBeInTheDocument();
    expect(screen.getByLabelText("Context for Bell")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("translates module hover to the entry's savedPlaceId", () => {
    const onHoverPlace = vi.fn();
    const saved = entriesOf("Pike").map((e) => ({ ...e, savedPlaceId: "sp1" }));
    render(<CompareTab {...base} entries={saved} onHoverPlace={onHoverPlace} neighborhood={onePlaceNeighborhood} runPoints={saved} />);
    fireEvent.mouseEnter(screen.getByLabelText("Context for Pike"));
    expect(onHoverPlace).toHaveBeenCalledWith("sp1");
    fireEvent.mouseLeave(screen.getByLabelText("Context for Pike"));
    expect(onHoverPlace).toHaveBeenLastCalledWith(null);
  });

  it("copies the share link when results exist", async () => {
    // clipboard idiom: define writeText mock via Object.defineProperty
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopyLink = vi.fn().mockReturnValue("https://example.test/?view=abc");
    render(<CompareTab {...base} entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /copy link to this view/i }));
    expect(onCopyLink).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("https://example.test/?view=abc");
  });

  it("N=2 result: callout + spine + expansions joined by index", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} />);
    expect(screen.getByText(/statistically lower than every other/i)).toBeInTheDocument();
    const ranked = screen.getByTestId("compare-ranked");
    expect(within(ranked).getAllByText("Full context")).toHaveLength(2);
    expect(within(ranked).getByText(/12 reported incidents within 250 m/)).toBeInTheDocument();
  });

  it("comparison without neighborhood: spine renders with the unavailable note", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} runPoints={entriesOf("Pike", "Bell")} />);
    expect(screen.getByText(/per-address context unavailable for this run/i)).toBeInTheDocument();
  });

  it("renders the combined incident disclosure from the incidents payload", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} incidents={incidents} />);
    fireEvent.click(screen.getByText(/see the 2 reported incidents/i));
    expect(screen.getByText("500 block of Pike St")).toBeInTheDocument();
  });

  it("still renders the incident disclosure when only the incidents payload survived", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} incidents={incidents} runPoints={entriesOf("Pike", "Bell")} />);
    expect(screen.getByText(/see the 2 reported incidents/i)).toBeInTheDocument();
    expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument();
  });

  it("address rows: remove fires with the index; unsaved rows offer Save", () => {
    const onRemoveEntry = vi.fn();
    const onSaveEntry = vi.fn();
    const entries = entriesOf("Pike", "Bell");
    render(<CompareTab {...base} onRemoveEntry={onRemoveEntry} onSaveEntry={onSaveEntry} savedKeys={new Set([keyOf(entries[1])])} entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: /remove Pike/i }));
    expect(onRemoveEntry).toHaveBeenCalledWith(0);
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    expect(saveButtons).toHaveLength(1);
    fireEvent.click(saveButtons[0]);
    expect(onSaveEntry).toHaveBeenCalledWith(entries[0]);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows the calls layer note on the calls layer and hides the category chips", () => {
    render(<CompareTab {...base} analysis={{ ...analysis, layer: "calls" }} entries={entriesOf("Pike")} />);
    expect(screen.getByText(/requests for service/i)).toBeInTheDocument();
    expect(screen.queryByText("Incident categories")).not.toBeInTheDocument();
  });

  it("mobile: collapses the querybar to a summary once results exist; Adjust reopens", () => {
    render(<CompareTab {...base} isMobile entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} />);
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /adjust/i }));
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
  });

  it("running: shows skeletons, not results", () => {
    render(<CompareTab {...base} running entries={entriesOf("Pike")} neighborhood={onePlaceNeighborhood} runPoints={entriesOf("Pike")} />);
    expect(screen.getByText(/running analysis/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Context for Pike")).not.toBeInTheDocument();
  });

  it("dynamic regions never emit safety-ranking vocabulary", () => {
    render(<CompareTab {...base} entries={entriesOf("Pike", "Bell")} comparison={clearSweep} neighborhood={twoPlaceNeighborhood} runPoints={entriesOf("Pike", "Bell")} incidents={incidents} />);
    const panel = screen.getByRole("tabpanel");
    const text = (panel.textContent ?? "").toLowerCase().replace("not a personal risk prediction", "");
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
