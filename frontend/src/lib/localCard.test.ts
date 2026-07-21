import { describe, expect, it } from "vitest";

import { cardFromCompareResults, localSummaryLine } from "./localCard";
import type { AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, SiteComparison } from "../types";

const analysis: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  radiusM: 500,
  offenseCategory: "PROPERTY",
  layer: "reported",
};

function makeNeighborhood(): NeighborhoodAnalysis {
  return {
    radius_m: 500,
    analysis_start_date: "2026-01-01",
    analysis_end_date: "2026-06-30",
    offense_category: "PROPERTY",
    places: [],
    pairwise: [],
  };
}

function makeIncidents(): IncidentDetailsResponse {
  return { incidents: [], returned_count: 0, total_count: 0, limit: 100, radius_m: 500 };
}

function makeComparison(): SiteComparison {
  const options = [
    { id: "a", label: "A", geometry_type: "place_buffer", radius_m: 500, incident_count: 1, exposure: 1, exposure_unit: "square_km_days", incident_rate: 1 },
    { id: "b", label: "B", geometry_type: "place_buffer", radius_m: 500, incident_count: 2, exposure: 1, exposure_unit: "square_km_days", incident_rate: 2 },
  ];
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 500,
    analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30",
    offense_category: "PROPERTY", offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: "not_statistically_clear", recommendation_option_id: null, recommendation_label: null, summary_text: "", caveat_text: "", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "", options, pairwise_results: [] },
  };
}

describe("cardFromCompareResults", () => {
  it("builds a compare card with its frozen neighborhood and incident panes", () => {
    const card = cardFromCompareResults({
      comparison: makeComparison(),
      neighborhood: makeNeighborhood(),
      incidents: makeIncidents(),
      analysis,
      placeIds: ["p1", "p2"],
    });
    expect(card).not.toBeNull();
    expect(card!.kind).toBe("compare");
    expect(card!.runId).toBeNull();
    expect(card!.placeIds).toEqual(["p1", "p2"]);
    expect(card!.comparison).not.toBeNull();
    expect(card!.neighborhood).toEqual(makeNeighborhood());
    expect(card!.incidents).toEqual(makeIncidents());
  });

  it("builds an analyze card from neighborhood-only results", () => {
    const card = cardFromCompareResults({
      comparison: null,
      neighborhood: makeNeighborhood(),
      incidents: makeIncidents(),
      analysis,
      placeIds: ["p1"],
    });
    expect(card).not.toBeNull();
    expect(card!.kind).toBe("analyze");
    expect(card!.runId).toBeNull();
    expect(card!.comparison).toBeNull();
    expect(card!.neighborhood).not.toBeNull();
    expect(card!.incidents).not.toBeNull();
  });

  it("returns null when neither pane has results", () => {
    expect(
      cardFromCompareResults({ comparison: null, neighborhood: null, incidents: null, analysis, placeIds: [] }),
    ).toBeNull();
  });

  it("freezes settings from the passed analysis (camelCase → snake_case)", () => {
    const card = cardFromCompareResults({
      comparison: null,
      neighborhood: makeNeighborhood(),
      incidents: null,
      analysis,
      placeIds: ["p1"],
    });
    expect(card!.settings).toEqual({
      radius_m: 500,
      analysis_start_date: "2026-01-01",
      analysis_end_date: "2026-06-30",
      offense_category: "PROPERTY",
      layer: "reported",
    });
  });

  it("maps an empty category string to null", () => {
    const card = cardFromCompareResults({
      comparison: null,
      neighborhood: makeNeighborhood(),
      incidents: null,
      analysis: { ...analysis, offenseCategory: "" },
      placeIds: ["p1"],
    });
    expect(card!.settings.offense_category).toBeNull();
  });
});

describe("localSummaryLine", () => {
  it("summarizes a compare card with the place count", () => {
    const card = cardFromCompareResults({
      comparison: makeComparison(), neighborhood: null, incidents: null, analysis, placeIds: ["p1", "p2"],
    })!;
    expect(localSummaryLine(card, 2)).toBe("Compared your 2 places — details in the card.");
  });

  it("summarizes an analyze card with a singular noun", () => {
    const card = cardFromCompareResults({
      comparison: null, neighborhood: makeNeighborhood(), incidents: null, analysis, placeIds: ["p1"],
    })!;
    expect(localSummaryLine(card, 1)).toBe("Pulled the reports around your place — details in the card.");
  });
});
