import { describe, expect, it } from "vitest";

import { incidentCountForPlace } from "./incidentSummaries";
import type { DashboardSummary } from "../types";

function summaryWith(count: number, radiusM: number): DashboardSummary {
  return {
    totals: { place_count: 1, visit_count: 0, incident_count: count },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [],
    crime_summaries: [
      {
        place_cluster_id: "p1",
        radius_m: radiusM,
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-24",
        offense_category: null,
        offense_subcategory: null,
        nibrs_group: null,
        incident_count: count,
        nearest_incident_m: null,
        incidents_per_visit: null,
        incidents_per_hour_dwell: null,
      },
    ],
    analysis: { available_radii_m: [radiusM] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  };
}

describe("incidentCountForPlace", () => {
  it("returns the matching count for place + radius", () => {
    expect(incidentCountForPlace(summaryWith(7, 250), "p1", 250)).toBe(7);
  });

  it("returns null when no summary matches the radius", () => {
    expect(incidentCountForPlace(summaryWith(7, 250), "p1", 500)).toBeNull();
  });

  it("returns null when summary is null", () => {
    expect(incidentCountForPlace(null, "p1", 250)).toBeNull();
  });
});
