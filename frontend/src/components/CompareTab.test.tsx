// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { AnalysisSettings, DashboardSummary, Place } from "../types";

const home: Place = { id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5, total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal" };
const office: Place = { ...home, id: "p2", display_label: "Office" };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY", layer: "reported" };

const summary: DashboardSummary = {
  totals: { place_count: 2, visit_count: 10, incident_count: 180 },
  privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [home, office],
  crime_summaries: [
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A", incident_count: 30, nearest_incident_m: 42, incidents_per_visit: 6, incidents_per_hour_dwell: null },
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PERSON", offense_subcategory: "ASSAULT", nibrs_group: "A", incident_count: 8, nearest_incident_m: 71, incidents_per_visit: 1.6, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: "A", incident_count: 120, nearest_incident_m: 18, incidents_per_visit: 24, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: "PERSON", offense_subcategory: "ASSAULT", nibrs_group: "A", incident_count: 22, nearest_incident_m: 36, incidents_per_visit: 4.4, incidents_per_hour_dwell: null },
  ],
  analysis: { available_radii_m: [250] },
  exports: { tableau_place_summary_csv: "/x.csv" },
};

afterEach(cleanup);

describe("CompareTab", () => {
  it("prompts to select two places when fewer are chosen", () => {
    render(<CompareTab selected={[home]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={vi.fn()} />);
    expect(screen.getByText(/select at least two places/i)).toBeInTheDocument();
  });

  it("shows per-place counts and the revised caveat, and runs", () => {
    const onRun = vi.fn();
    render(<CompareTab selected={[home, office]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={onRun} />);

    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText(/nearest 42 m/i)).toBeInTheDocument();
    expect(screen.queryByText(/per expected visit/i)).not.toBeInTheDocument();
    expect(screen.getByText(/reported incident context, not a personal risk prediction/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("shows incident-type breakdowns without presenting them as personal risk predictions", () => {
    render(<CompareTab selected={[home, office]} analysis={{ ...analysis, offenseCategory: "" }} summary={summary} comparison={null} running={false} onRun={vi.fn()} />);

    expect(screen.getByText("Person / Assault")).toBeInTheDocument();
    expect(screen.getByText("Office has 14 more Person / Assault than Home.")).toBeInTheDocument();
    expect(screen.getByText(/reported incident context, not a personal risk prediction/i)).toBeInTheDocument();
    expect(screen.queryByText(/more likely to experience assault/i)).not.toBeInTheDocument();
  });

  it("explains when the current filter cannot answer assault or person-incident questions", () => {
    render(<CompareTab selected={[home, office]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={vi.fn()} />);

    expect(screen.getByText(/run Analyze with All reported or Person to compare assault/i)).toBeInTheDocument();
  });

  it("keeps the compare action in a sticky bar, not an absolute footer or spacer", () => {
    const { container } = render(<CompareTab selected={[home, office]} analysis={analysis} summary={summary} comparison={null} running={false} onRun={vi.fn()} />);
    expect(container.querySelector(".mc-footer")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-compare-actions")).toBeInTheDocument();
    expect(container.querySelector(".mc-compare-actions")?.contains(screen.getByRole("button", { name: /compare places/i }))).toBe(true);
  });
});
