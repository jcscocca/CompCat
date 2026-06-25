// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzeTab } from "./AnalyzeTab";
import type { AnalysisSettings, DashboardSummary, Place } from "../types";

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

  it("summarizes analyzed findings in plain language", () => {
    render(<AnalyzeTab selected={[home, office]} analysis={{ ...analysis, offenseCategory: "" }} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);

    expect(screen.getByText("Findings summary")).toBeInTheDocument();
    expect(screen.getByText("Office has the highest reported incident count in the selected radius (152 reported incidents).")).toBeInTheDocument();
    expect(screen.getByText("Property / Theft is the largest reported incident type across the selected places.")).toBeInTheDocument();
    expect(screen.getByText("Person / Assault appears in the selected places; use Compare for side-by-side context.")).toBeInTheDocument();
    expect(screen.getByText(/reported incident patterns do not predict personal risk/i)).toBeInTheDocument();
    expect(screen.queryByText(/more likely to experience/i)).not.toBeInTheDocument();
  });

  it("summarizes a single selected place without pretending to compare it", () => {
    render(<AnalyzeTab selected={[home]} analysis={{ ...analysis, offenseCategory: "" }} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);

    expect(screen.getByText("Home has 44 matching reported incidents within 250 m for the selected filters.")).toBeInTheDocument();
    expect(screen.queryByText(/highest reported incident count/i)).not.toBeInTheDocument();
  });

  it("shows aggregate charts for crime mix and specific offenses", () => {
    render(<AnalyzeTab selected={[home, office]} analysis={{ ...analysis, offenseCategory: "" }} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);

    const charts = screen.getByLabelText("Reported incident charts");
    expect(within(charts).getByText("Crime mix")).toBeInTheDocument();
    expect(within(charts).getByText("Property")).toBeInTheDocument();
    expect(within(charts).getByText("160")).toBeInTheDocument();
    expect(within(charts).getByText("Person / violent")).toBeInTheDocument();
    expect(within(charts).getAllByText("30").length).toBeGreaterThanOrEqual(2);
    expect(within(charts).getByText("Other non-violent")).toBeInTheDocument();
    expect(within(charts).getAllByText("6").length).toBeGreaterThanOrEqual(2);

    expect(within(charts).getByText("Specific offenses")).toBeInTheDocument();
    expect(within(charts).getByText("Theft")).toBeInTheDocument();
    expect(within(charts).getByText("150")).toBeInTheDocument();
    expect(within(charts).getByText("Assault")).toBeInTheDocument();
    expect(within(charts).getByText("Burglary")).toBeInTheDocument();
  });

  it("prompts users to run analysis before showing findings", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={{ ...analyzedSummary, crime_summaries: [] }} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);

    expect(screen.getByText("Run analysis to summarize reported incident patterns for the selected places.")).toBeInTheDocument();
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

  it("places the run controls in a sticky query bar above the findings, with no absolute footer", () => {
    const { container } = render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-querybar")).toBeInTheDocument();
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    const queryBar = container.querySelector(".mc-querybar") as HTMLElement;
    expect(queryBar.contains(screen.getByRole("button", { name: /run analysis/i }))).toBe(true);
  });

  it("renders an inline error when one is provided", () => {
    render(<AnalyzeTab selected={[home]} analysis={analysis} summary={analyzedSummary} availableRadii={[250]} running={false} error="Unable to run analysis. Try again." onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText("Unable to run analysis. Try again.")).toBeInTheDocument();
  });
});
