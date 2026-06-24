// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareTab } from "./CompareTab";
import type { AnalysisSettings, DashboardSummary, Place } from "../types";

const home: Place = { id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5, total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal" };
const office: Place = { ...home, id: "p2", display_label: "Office" };
const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY" };

const summary: DashboardSummary = {
  totals: { place_count: 2, visit_count: 10, incident_count: 180 },
  privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [home, office],
  crime_summaries: [
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: null, offense_subcategory: null, nibrs_group: null, incident_count: 38, nearest_incident_m: null, incidents_per_visit: null, incidents_per_hour_dwell: null },
    { place_cluster_id: "p2", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24", offense_category: null, offense_subcategory: null, nibrs_group: null, incident_count: 142, nearest_incident_m: null, incidents_per_visit: null, incidents_per_hour_dwell: null },
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
    expect(screen.getByText(/does not identify one as statistically lower-incident/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));
    expect(onRun).toHaveBeenCalled();
  });
});
