// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { incidentNoun } from "../lib/layerCopy";
import type {
  NeighborhoodPlace,
  ReferenceCircleComparison,
} from "../types";
import {
  ReferenceCirclePlot,
  referencePercentages,
  referenceSummary,
} from "./ReferenceCirclePlot";

function reference(
  kind: ReferenceCircleComparison["kind"],
  over: Partial<ReferenceCircleComparison> = {},
): ReferenceCircleComparison {
  return {
    kind,
    label: kind === "mcpp" ? "Downtown Commercial MCPP" : kind === "sector" ? "Sector M" : "Citywide",
    available: true,
    adequacy_status: "met",
    sampling_frame: "street_segment_midpoints",
    sampling_frame_version: "seattle_snd_open_public_street_midpoints_v1",
    computation: kind === "mcpp" ? "exact" : "monte_carlo",
    geography_components: [
      {
        id: kind.toUpperCase(),
        label: kind === "city" ? "Seattle" : kind.toUpperCase(),
        weight: 1,
        center_count: kind === "mcpp" ? 420 : 5_000,
      },
    ],
    reference_center_count: kind === "mcpp" ? 420 : 5_000,
    reference_draw_count: kind === "mcpp" ? 420 : 2_500,
    monte_carlo_error: kind === "mcpp" ? null : 0.0196,
    covered_area_share: 1,
    effective_geographies: 1,
    target_count: 12,
    p10: 3,
    p25: 6,
    median: 8,
    p75: 15,
    p90: 20,
    share_below: 0.676,
    share_equal: 0.071,
    share_above: 0.253,
    midrank_percentile: 0.7115,
    warnings: [],
    ...over,
  };
}

const place: NeighborhoodPlace = {
  place_id: "p1",
  place_label: "Library",
  beat: "M2",
  radius_m: 250,
  baseline_available: true,
  decision: "not_clear",
  place_incident_count: 12,
  nearest_incident_m: 42,
  baselines: [],
  reference_comparisons: [reference("mcpp"), reference("sector"), reference("city")],
  category_breakdown: [],
};

afterEach(cleanup);

describe("ReferenceCirclePlot", () => {
  it("renders equal-radius quantiles, tie-aware shares, and an accessible chart description", () => {
    render(<ReferenceCirclePlot place={place} noun={incidentNoun("reported")} />);

    expect(screen.getByText("Compared with eligible street locations")).toBeInTheDocument();
    expect(screen.getAllByText("Downtown Commercial MCPP").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/median 8 · middle 50% 6–15/)).toHaveLength(3);
    expect(screen.getAllByText(/68%/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: /target 12; median 8/i })).toHaveLength(3);
    expect(screen.queryByText(/p-value|significant|expected crime/i)).not.toBeInTheDocument();
  });

  it("shows calculation, frame provenance, weights, and nearest matching detail", () => {
    const detailedPlace = {
      ...place,
      reference_comparisons: [
        reference("mcpp", {
          covered_area_share: 0.999,
          geography_components: [
            { id: "A", label: "Primary", weight: 0.996, center_count: 419 },
            { id: "B", label: "Boundary sliver", weight: 0.004, center_count: 1 },
          ],
          warnings: ["multi_geography_context", "partial_reference_frame_coverage"],
        }),
        reference("sector"),
        reference("city"),
      ],
    };
    render(<ReferenceCirclePlot place={detailedPlace} noun={incidentNoun("reported")} />);
    fireEvent.click(screen.getByText("Reference details"));
    const details = screen.getByText("Reference details").closest("details")!;

    expect(within(details).getByText("Exact · all 420 frame memberships")).toBeInTheDocument();
    expect(within(details).getAllByText(/Monte Carlo · 2,500 draws · ±2.0 points/)).toHaveLength(2);
    expect(within(details).getByText("42 m")).toBeInTheDocument();
    expect(within(details).getByText("99.9%")).toBeInTheDocument();
    expect(within(details).getByText(/Boundary sliver <1%/)).toBeInTheDocument();
    expect(within(details).getByText(/overlap-weighted mixture/)).toBeInTheDocument();
    expect(within(details).getByText(/no eligible street centers/)).toBeInTheDocument();
    expect(within(details).getByText(/seattle_snd_open_public_street_midpoints_v1/)).toBeInTheDocument();
  });

  it("explains an unavailable local row while preserving broader references", () => {
    const unavailable: NeighborhoodPlace = {
      ...place,
      reference_comparisons: [
        reference("mcpp", {
          available: false,
          adequacy_status: "insufficient_polygon_coverage",
          computation: null,
          p10: null,
          p25: null,
          median: null,
          p75: null,
          p90: null,
          share_below: null,
          share_equal: null,
          share_above: null,
          midrank_percentile: null,
        }),
        reference("city"),
      ],
    };
    render(<ReferenceCirclePlot place={unavailable} noun={incidentNoun("reported")} />);

    expect(screen.getAllByText(/Too little of this circle is covered/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Citywide").length).toBeGreaterThan(0);
  });

  it("rounds fewer/same/more to integers that still total 100", () => {
    const percentages = referencePercentages(reference("mcpp"));
    expect(percentages).toEqual([68, 7, 25]);
    expect(percentages.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("uses the first adequate geography in the compact descriptive sentence", () => {
    expect(referenceSummary(place, incidentNoun("reported"))).toBe(
      "Among eligible street-centered circles in Downtown Commercial MCPP, 68% had fewer reported incidents, 7% had the same number, and 25% had more.",
    );
  });
});
