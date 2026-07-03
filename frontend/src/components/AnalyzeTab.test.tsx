// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzeTab } from "./AnalyzeTab";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";
import type { AnalysisSettings, DashboardSummary, NeighborhoodAnalysis, NeighborhoodPlace, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};
const office: Place = { ...home, id: "p2", display_label: "Office", visit_count: 4 };

const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY", layer: "reported" };
const analyzedSummary: DashboardSummary = {
  totals: { place_count: 2, visit_count: 9, incident_count: 180 },
  privacy: { normal: 2, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [home, office],
  crime_summaries: [
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A", incident_count: 30, nearest_incident_m: 42, incidents_per_visit: 6, incidents_per_hour_dwell: null },
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PERSON", offense_subcategory: "ASSAULT", nibrs_group: "A", incident_count: 8, nearest_incident_m: 71, incidents_per_visit: 1.6, incidents_per_hour_dwell: null },
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "SOCIETY", offense_subcategory: "TRESPASS", nibrs_group: "B", incident_count: 6, nearest_incident_m: 83, incidents_per_visit: 1.2, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A", incident_count: 120, nearest_incident_m: 18, incidents_per_visit: 30, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PERSON", offense_subcategory: "ASSAULT", nibrs_group: "A", incident_count: 22, nearest_incident_m: 36, incidents_per_visit: 5.5, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PROPERTY", offense_subcategory: "BURGLARY", nibrs_group: "A", incident_count: 10, nearest_incident_m: 44, incidents_per_visit: 2.5, incidents_per_hour_dwell: null },
  ],
  analysis: { available_radii_m: [250] },
  exports: { tableau_place_summary_csv: "/x.csv" },
};

const homePlace: NeighborhoodPlace = {
  place_id: "p1", place_label: "Home", beat: "M2", radius_m: 250,
  baseline_available: true, decision: "above_clear", place_incident_count: 12,
  beat_incident_count: 60, place_rate: 0.67, beat_rate: 0.17, rate_ratio: 4.0,
  ci_lower: 2.1, ci_upper: 7.6, adjusted_p_value: 0.002, exact_p_value: 0.012,
  method: "wald_log_rate_ratio",
  overdispersion_status: "poisson_ok", minimum_data_status: "met",
  nearest_incident_m: 42, monthly_counts: [1, 2, 1, 3, 2, 3],
  category_breakdown: [
    { label: "Theft", place_count: 5, place_share: 0.71, beat_share: 0.20 },
    { label: "Assault", place_count: 2, place_share: 0.29, beat_share: null },
  ],
  temporal: {
    // weekdays 17:00 → 4 each (20 total); Sat 02:00 → 20. total_with_time = 40.
    hour_by_dow: Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => (d <= 4 && h === 17 ? 4 : d === 5 && h === 2 ? 20 : 0)),
    ),
    hour_counts: Array.from({ length: 24 }, (_, h) => (h === 17 ? 20 : h === 2 ? 20 : 0)),
    dow_counts: [4, 4, 4, 4, 4, 20, 0],
    total_with_time: 40,
    without_time: 0,
  },
};

const neighborhood: NeighborhoodAnalysis = {
  radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30",
  offense_category: null, pairwise: [], places: [homePlace],
};

afterEach(cleanup);

describe("AnalyzeTab", () => {
  it("emits control changes and runs when a place is selected", () => {
    const onChange = vi.fn();
    const onRun = vi.fn();
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250, 500, 1000]} running={false} onChange={onChange} onRun={onRun} />);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-02-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-02-01" });

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });

    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("on the calls layer hides incident categories and shows the calls-for-service caveat", () => {
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={{ ...analysis, layer: "calls" }}
        availableRadii={[250]}
        running={false}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    // Category chips are not meaningful for 911 calls (no offense category), so they're hidden.
    expect(screen.queryByRole("button", { name: "Property" })).not.toBeInTheDocument();
    expect(screen.getByText(/requests for service/i)).toBeInTheDocument();
  });

  it("disables run when nothing is selected", () => {
    render(<AnalyzeTab selected={[]} analysis={analysis} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("renders a verdict block and exposes every measure’s definition", () => {
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        error={undefined}
        panelWidthPx={640}
        neighborhood={neighborhood}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Home has more reported incidents than its surrounding beat."),
    ).toBeInTheDocument();
    expect(screen.getByText("✓ statistically clear")).toBeInTheDocument();
    expect(screen.getByText("4.0×")).toBeInTheDocument();
    expect(
      screen.getByText(/within 250 m · 2026-01-01 – 2026-06-30/),
    ).toBeInTheDocument();
    const ids = new Set(METHODS_DEFINITIONS.map((d) => d.id));
    for (const id of ["reportedIncidentRate", "beatBaselineRate", "rateRatio", "confidenceInterval", "adjustedPValue", "overdispersion", "minimumDataStatus", "nearestIncident", "monthlyTrend"]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("shows the confidence interval in analytical detail, not on the verdict line", () => {
    const { container } = render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        neighborhood={neighborhood}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    const sub = container.querySelector(".mc-verdict-sub")!;
    expect(sub.textContent).not.toMatch(/95% CI/);
    const details = container.querySelector(".mc-analytical")!;
    expect(details.textContent).toMatch(/95% CI/);
  });

  it("copies the share link when Copy link to this view is clicked", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopyLink = vi.fn(() => "http://localhost/?view=abc");
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        neighborhood={neighborhood}
        onChange={vi.fn()}
        onRun={vi.fn()}
        onCopyLink={onCopyLink}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link to this view" }));
    expect(onCopyLink).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("http://localhost/?view=abc");
  });

  it("no longer renders the retired crime-mix chart", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={null} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.queryByText("Crime mix")).not.toBeInTheDocument();
  });

  it("shows a fallback line when a place has no beat baseline", () => {
    const noBaseline: NeighborhoodPlace = {
      ...homePlace, place_id: "p3", place_label: "Cabin", baseline_available: false,
      decision: "baseline_unavailable", place_incident_count: 3,
    };
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        neighborhood={{ ...neighborhood, places: [noBaseline] }}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText("No neighborhood baseline available for Cabin.")).toBeInTheDocument();
    expect(
      screen.getByText(/3 reported incidents in range; no beat baseline\./i),
    ).toBeInTheDocument();
  });

  it("renders one line per pairwise comparison", () => {
    render(
      <AnalyzeTab
        selected={[home, office]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        neighborhood={{
          ...neighborhood,
          places: [homePlace],
          pairwise: [
            { a_place_id: "p1", a_label: "Home", b_place_id: "p2", b_label: "Office", rate_ratio: 2.5, ci_lower: 1.2, ci_upper: 5.1, adjusted_p_value: 0.01 },
          ],
        }}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText(/Home vs Office: 2\.5× · 95% CI 1\.2–5\.1× · adj p 0\.010/i)).toBeInTheDocument();
  });

  it("renders reported incident details in a table", () => {
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        incidentDetails={{
          incidents: [
            {
              place_id: "p1",
              place_label: "Home",
              incident_id: "incident-1",
              external_incident_id: "ext-1",
              report_number: "R-100",
              occurred_at: "2026-01-02T10:00:00Z",
              reported_at: null,
              offense_category: "PROPERTY",
              offense_subcategory: "THEFT",
              nibrs_group: "A",
              block_address: "100 BLOCK MAIN ST",
              distance_m: 42.4,
            },
          ],
          returned_count: 1,
          total_count: 1,
          limit: 100,
          radius_m: 250,
        }}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(/See the 1 reported incident\b/i));
    const table = screen.getByRole("table");
    expect(screen.getByText("Reported incidents near selected places")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Place" })).toBeInTheDocument();
    expect(within(table).getByText("2026-01-02 10:00 UTC")).toBeInTheDocument();
    expect(within(table).getByText("Property")).toBeInTheDocument();
    expect(within(table).getByText("Theft")).toBeInTheDocument();
    expect(within(table).getByText("42 m")).toBeInTheDocument();
    expect(within(table).getByText("100 BLOCK MAIN ST")).toBeInTheDocument();
    expect(within(table).getByText("R-100")).toBeInTheDocument();
  });

  it("shows an empty incident-detail message after analysis returns no rows", () => {
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        incidentDetails={{ incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 250 }}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getByText("No matching reported incidents for the selected filters.")).toBeInTheDocument();
  });

  it("places the run controls in a sticky query bar above the results, with no absolute footer", () => {
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-querybar")).toBeInTheDocument();
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    const queryBar = container.querySelector(".mc-querybar") as HTMLElement;
    expect(queryBar.contains(screen.getByRole("button", { name: /run analysis/i }))).toBe(true);
  });

  it("renders an inline error with an assertive alert role when one is provided", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} error="Unable to run analysis. Try again." onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to run analysis. Try again.");
  });

  const oneIncident = {
    incidents: [
      {
        place_id: "p1", place_label: "Home", incident_id: "incident-1", external_incident_id: "ext-1",
        report_number: "R-100", occurred_at: "2026-01-02T10:00:00Z", reported_at: null,
        offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A",
        block_address: "100 BLOCK MAIN ST", distance_m: 42.4,
      },
    ],
    returned_count: 1, total_count: 1, limit: 100, radius_m: 250,
  };

  it("renders incidents as cards (no table) when the panel is narrow", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} panelWidthPx={380} incidentDetails={oneIncident} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/See the 1 reported incident\b/i));
    expect(screen.getByText("100 BLOCK MAIN ST", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("42 m")).toBeInTheDocument();
  });

  it("renders incidents as a full table when the panel is wide", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} panelWidthPx={640} incidentDetails={oneIncident} onChange={vi.fn()} onRun={vi.fn()} />);
    fireEvent.click(screen.getByText(/See the 1 reported incident\b/i));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("relabels incident copy to 911 calls on the calls layer", () => {
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={{ ...analysis, layer: "calls" }}
        availableRadii={[250]}
        running={false}
        panelWidthPx={640}
        neighborhood={{ ...neighborhood, places: [homePlace] }}
        incidentDetails={oneIncident}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    // Verdict, incident-details header, and reveal summary all reflect the active layer.
    expect(screen.getByText(/Home has more 911 calls than its surrounding beat\./i)).toBeInTheDocument();
    expect(screen.getByText("911 calls near selected places")).toBeInTheDocument();
    expect(screen.getByText(/See the 1 911 call\b/i)).toBeInTheDocument();
    // The incident table drops the (always-empty) Category column and renames Subcategory.
    expect(screen.getByRole("columnheader", { name: "Call type" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Category" })).not.toBeInTheDocument();
  });

  it("shows loading skeletons while analysis is running", () => {
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={true} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText("Running analysis…")).toBeInTheDocument();
    expect(container.querySelector(".mc-skeleton")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Verdict for/i)).not.toBeInTheDocument();
  });

  it("renders a sparkline bar for each monthly_counts entry", () => {
    // homePlace has monthly_counts of length 6; the VerdictCard renders one <span> per entry
    const { container } = render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        availableRadii={[250]}
        running={false}
        neighborhood={neighborhood}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".mc-spark span").length).toBe(6);
  });

  it("renders hour and day temporal profiles with the window callout", () => {
    const { container } = render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={neighborhood} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    const profiles = container.querySelectorAll(".mc-temporal-profile");
    expect(profiles.length).toBe(2);
    expect(profiles[0].querySelectorAll(".mc-temporal-bar").length).toBe(24);
    expect(profiles[1].querySelectorAll(".mc-temporal-bar").length).toBe(7);
    // default window = weekdays 16–19 → hour 17 (20) / 40 = 50%
    expect(screen.getByText(/50% of the 40 reported incidents with a recorded time/i)).toBeInTheDocument();
  });

  it("recomputes the callout when the travel window changes", () => {
    render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={neighborhood} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    // Weekends 16–19 contains none of the seeded cells (Sat activity is at 02:00) → 0%.
    fireEvent.click(screen.getByRole("button", { name: "Weekends" }));
    expect(screen.getByText(/0% of the 40 reported incidents with a recorded time/i)).toBeInTheDocument();
  });

  it("shows a low-sample caution and a missing-time note", () => {
    const lowN: NeighborhoodPlace = {
      ...homePlace,
      temporal: { ...homePlace.temporal!, total_with_time: 8, without_time: 3 },
    };
    render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={{ ...neighborhood, places: [lowN] }} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    expect(screen.getByText(/Based on 8 reported incidents — interpret with caution\./i)).toBeInTheDocument();
    expect(screen.getByText(/3 reported incidents had no recorded time/i)).toBeInTheDocument();
  });

  it("shows an empty temporal state when no incidents have a recorded time", () => {
    const noTime: NeighborhoodPlace = {
      ...homePlace,
      temporal: { hour_counts: Array(24).fill(0), dow_counts: Array(7).fill(0), hour_by_dow: Array.from({ length: 7 }, () => Array(24).fill(0)), total_with_time: 0, without_time: 0 },
    };
    const { container } = render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={{ ...neighborhood, places: [noTime] }} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    expect(screen.getByText("No reported incidents with a recorded time in this area.")).toBeInTheDocument();
    expect(container.querySelectorAll(".mc-temporal-bar").length).toBe(0);
  });

  it("renders incident type rows with place-share and beat-share", () => {
    const { container } = render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={neighborhood} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    const rows = container.querySelectorAll(".mc-cat-row");
    expect(rows.length).toBe(2);
    // First row: Theft — 71% here · 20% nearby.
    expect(rows[0].textContent).toMatch(/Theft/);
    expect(rows[0].textContent).toMatch(/71%/);
    expect(rows[0].textContent).toMatch(/20%/);
    // Second row: Assault — 29% here, no beat share.
    expect(rows[1].textContent).toMatch(/Assault/);
    expect(rows[1].textContent).toMatch(/29%/);
  });

  it("shows place share only when beat_share is null", () => {
    render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={neighborhood} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    // Assault row has beat_share: null → shows "29% here" but no "nearby".
    const assaultRow = Array.from(document.querySelectorAll(".mc-cat-row")).find(
      (el) => el.textContent?.includes("Assault"),
    );
    expect(assaultRow).toBeTruthy();
    expect(assaultRow!.textContent).toMatch(/29%/);
    expect(assaultRow!.textContent).not.toMatch(/nearby/);
  });

  it('renders an "Other" row when present in category_breakdown', () => {
    const withOther: NeighborhoodPlace = {
      ...homePlace,
      category_breakdown: [
        { label: "Theft", place_count: 5, place_share: 0.71, beat_share: 0.20 },
        { label: "Other", place_count: 2, place_share: 0.29, beat_share: 0.05 },
      ],
    };
    const { container } = render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={{ ...neighborhood, places: [withOther] }} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    const rows = container.querySelectorAll(".mc-cat-row");
    expect(rows.length).toBe(2);
    const otherRow = Array.from(rows).find((el) => el.textContent?.includes("Other"));
    expect(otherRow).toBeTruthy();
    // Other row: 29% here · 5% nearby.
    expect(otherRow!.textContent).toMatch(/29%/);
    expect(otherRow!.textContent).toMatch(/5%/);
  });

  it("hides the category breakdown section when category_breakdown is empty", () => {
    const noBreakdown: NeighborhoodPlace = {
      ...homePlace,
      category_breakdown: [],
    };
    const { container } = render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={{ ...neighborhood, places: [noBreakdown] }} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    expect(container.querySelector(".mc-cat-breakdown")).not.toBeInTheDocument();
  });

  it("renders the category breakdown for a degraded place with place share only", () => {
    const degraded: NeighborhoodPlace = {
      ...homePlace,
      place_id: "p3", place_label: "Cabin", baseline_available: false,
      decision: "baseline_unavailable", place_incident_count: 7,
      category_breakdown: [
        { label: "Theft", place_count: 5, place_share: 0.71, beat_share: null },
        { label: "Assault", place_count: 2, place_share: 0.29, beat_share: null },
      ],
    };
    const { container } = render(
      <AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250]} running={false} neighborhood={{ ...neighborhood, places: [degraded] }} onChange={vi.fn()} onRun={vi.fn()} />,
    );
    const rows = container.querySelectorAll(".mc-cat-row");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toMatch(/Theft/);
    expect(rows[0].textContent).toMatch(/71%\s*here/);
    // Degraded → no beat baseline → no "nearby" anywhere in the breakdown.
    expect(container.querySelector(".mc-cat-breakdown")!.textContent).not.toMatch(/nearby/);
  });

  it("shows the arrests enforcement note and hides the category filter on the arrests layer", () => {
    render(<AnalyzeTab selected={[home]} analysis={{ ...analysis, layer: "arrests" }} availableRadii={[250, 500, 1000]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/enforcement activity, not reported incidents/i)).toBeInTheDocument();
    expect(screen.queryByText(/incident categories/i)).not.toBeInTheDocument();
  });

  it("shows the category filter and no arrests note on the reported layer", () => {
    render(<AnalyzeTab selected={[home]} analysis={{ ...analysis, layer: "reported" }} availableRadii={[250, 500, 1000]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.queryByText(/enforcement activity, not reported incidents/i)).not.toBeInTheDocument();
    expect(screen.getByText(/incident categories/i)).toBeInTheDocument();
  });
});
