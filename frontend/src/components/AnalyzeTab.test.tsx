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

const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY" };
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
  ci_lower: 2.1, ci_upper: 7.6, adjusted_p_value: 0.002, method: "exact_conditional_poisson",
  overdispersion_status: "poisson_ok", minimum_data_status: "met",
  nearest_incident_m: 42, monthly_counts: [1, 2, 1, 3, 2, 3], type_mix: [{ label: "ASSAULT", count: 7 }],
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
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250, 500, 1000]} running={false} onChange={onChange} onRun={onRun} />);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-02-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-02-01" });

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });

    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("disables run when nothing is selected", () => {
    render(<AnalyzeTab selected={[]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("renders a verdict block and exposes every measure’s definition", () => {
    render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        summary={analyzedSummary}
        availableRadii={[250]}
        running={false}
        error={undefined}
        panelWidthPx={640}
        neighborhood={neighborhood}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText(/above its beat/i)).toBeInTheDocument();
    expect(screen.getByText("4.0×")).toBeInTheDocument();
    const ids = new Set(METHODS_DEFINITIONS.map((d) => d.id));
    for (const id of ["reportedIncidentRate", "beatBaselineRate", "rateRatio", "confidenceInterval", "adjustedPValue", "overdispersion", "minimumDataStatus", "nearestIncident", "monthlyTrend"]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("no longer renders the retired crime-mix chart", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} neighborhood={null} onChange={vi.fn()} onRun={vi.fn()} />);
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
        summary={analyzedSummary}
        availableRadii={[250]}
        running={false}
        neighborhood={{ ...neighborhood, places: [noBaseline] }}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByText(/neighborhood baseline unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/3 reported incidents in range; no beat baseline\./i)).toBeInTheDocument();
  });

  it("renders one line per pairwise comparison", () => {
    render(
      <AnalyzeTab
        selected={[home, office]}
        analysis={analysis}
        summary={analyzedSummary}
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
        summary={analyzedSummary}
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
        summary={analyzedSummary}
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
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-querybar")).toBeInTheDocument();
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    const queryBar = container.querySelector(".mc-querybar") as HTMLElement;
    expect(queryBar.contains(screen.getByRole("button", { name: /run analysis/i }))).toBe(true);
  });

  it("renders an inline error with an assertive alert role when one is provided", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} error="Unable to run analysis. Try again." onChange={vi.fn()} onRun={vi.fn()} />);
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
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} panelWidthPx={380} incidentDetails={oneIncident} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("100 BLOCK MAIN ST", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("42 m")).toBeInTheDocument();
  });

  it("renders incidents as a full table when the panel is wide", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} panelWidthPx={640} incidentDetails={oneIncident} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows loading skeletons while analysis is running", () => {
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={true} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText("Running analysis…")).toBeInTheDocument();
    expect(container.querySelector(".mc-skeleton")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Verdict for/i)).not.toBeInTheDocument();
  });

  it("renders a sparkline bar for each monthly_counts entry", () => {
    // homePlace has monthly_counts of length 6; the VerdictBlock renders one <span> per entry
    const { container } = render(
      <AnalyzeTab
        selected={[home]}
        analysis={analysis}
        summary={analyzedSummary}
        availableRadii={[250]}
        running={false}
        neighborhood={neighborhood}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".mc-spark span").length).toBe(6);
  });
});
