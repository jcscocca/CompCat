import { describe, expect, it } from "vitest";

import { hasIncidentSummaryForAnalysis, incidentCountForPlace } from "./incidentSummaries";
import type { AnalysisSettings, DashboardSummary } from "../types";

const ANALYSIS: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-06-24",
  radiusM: 250,
  offenseCategory: "",
  layer: "reported",
};
const PLACE_IDS = new Set(["p1"]);

function summaryWith(count: number, radiusM: number): DashboardSummary {
  return {
    layer: "reported",
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
        analysis_run_id: "run-1",
        layer: "reported",
      },
    ],
    analysis: {
      available_radii_m: [radiusM],
      persisted_scope: {
        run_id: "run-1",
        place_ids: ["p1"],
        radii_m: [radiusM],
        analysis_start_date: ANALYSIS.startDate,
        analysis_end_date: ANALYSIS.endDate,
        offense_category: null,
        offense_subcategory: null,
        nibrs_group: null,
        layer: "reported",
      },
    },
    exports: { tableau_place_summary_csv: "/x.csv" },
  };
}

describe("incidentCountForPlace", () => {
  it("returns the matching count for the complete persisted scope", () => {
    expect(incidentCountForPlace(summaryWith(7, 250), "p1", ANALYSIS, PLACE_IDS)).toBe(7);
  });

  it("sums all category rows when the current category is unfiltered", () => {
    const summary = summaryWith(7, 250);
    summary.crime_summaries.push({
      ...summary.crime_summaries[0],
      offense_category: "PERSON",
      offense_subcategory: "ASSAULT",
      incident_count: 3,
    });

    expect(incidentCountForPlace(summary, "p1", ANALYSIS, PLACE_IDS)).toBe(10);
  });

  it("filters category rows when a category is selected", () => {
    const summary = summaryWith(7, 250);
    summary.crime_summaries = [{
      ...summary.crime_summaries[0],
      offense_category: "PERSON",
      offense_subcategory: "ASSAULT",
      incident_count: 3,
    }];
    summary.analysis.persisted_scope!.offense_category = "PERSON";

    expect(incidentCountForPlace(
      summary,
      "p1",
      { ...ANALYSIS, offenseCategory: "PERSON" },
      PLACE_IDS,
    )).toBe(3);
  });

  it.each([
    ["radius", { radiusM: 500 }],
    ["start date", { startDate: "2025-01-01" }],
    ["end date", { endDate: "2026-12-31" }],
    ["category", { offenseCategory: "PROPERTY" }],
    ["layer", { layer: "arrests" as const }],
  ])("returns null when the persisted summary does not match the current %s", (_label, patch) => {
    expect(incidentCountForPlace(
      summaryWith(7, 250),
      "p1",
      { ...ANALYSIS, ...patch },
      PLACE_IDS,
    )).toBeNull();
  });

  it("treats a legacy summary without a layer as reported only", () => {
    const summary = summaryWith(7, 250);
    delete summary.layer;
    delete summary.crime_summaries[0].layer;
    expect(incidentCountForPlace(summary, "p1", ANALYSIS, PLACE_IDS)).toBe(7);
    expect(incidentCountForPlace(
      summary,
      "p1",
      { ...ANALYSIS, layer: "calls" },
      PLACE_IDS,
    )).toBeNull();
  });

  it("fails closed when run or selected-place provenance differs", () => {
    const wrongRun = summaryWith(7, 250);
    wrongRun.crime_summaries[0].analysis_run_id = "run-old";
    expect(incidentCountForPlace(wrongRun, "p1", ANALYSIS, PLACE_IDS)).toBeNull();

    const wrongPlaces = summaryWith(7, 250);
    expect(incidentCountForPlace(wrongPlaces, "p1", ANALYSIS, new Set(["p1", "p2"]))).toBeNull();
  });

  it.each([
    ["subcategory", { offense_subcategory: "THEFT" }],
    ["NIBRS group", { nibrs_group: "A" }],
  ])("fails closed for a run narrowed by an unrepresentable %s", (_label, patch) => {
    const summary = summaryWith(7, 250);
    Object.assign(summary.analysis.persisted_scope!, patch);
    expect(incidentCountForPlace(summary, "p1", ANALYSIS, PLACE_IDS)).toBeNull();
  });

  it("recognizes a zero-row run only for its exact selected places and scope", () => {
    const summary = summaryWith(7, 250);
    summary.crime_summaries = [];
    expect(hasIncidentSummaryForAnalysis(summary, ANALYSIS, PLACE_IDS)).toBe(true);
    expect(incidentCountForPlace(summary, "p1", ANALYSIS, PLACE_IDS)).toBeNull();
    expect(hasIncidentSummaryForAnalysis(summary, ANALYSIS, new Set(["p2"]))).toBe(false);
  });

  it("hides persisted rows from an older API that omits exact run metadata", () => {
    const summary = summaryWith(7, 250);
    delete summary.analysis.persisted_scope;
    expect(incidentCountForPlace(summary, "p1", ANALYSIS, PLACE_IDS)).toBeNull();
  });

  it("returns null when summary is null", () => {
    expect(incidentCountForPlace(null, "p1", ANALYSIS, PLACE_IDS)).toBeNull();
  });
});
