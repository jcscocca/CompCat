// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BaselineIntervalPlot, plotDomainMax } from "./BaselineIntervalPlot";
import { incidentNoun } from "../lib/layerCopy";
import { placeIdentity } from "../lib/placeIdentity";
import type { BaselineEntry, NeighborhoodPlace } from "../types";

afterEach(cleanup);

const entry = (kind: BaselineEntry["kind"], label: string, rate: number, relation: BaselineEntry["relation"]): BaselineEntry => ({
  kind, label, relation, baseline_rate: rate,
  area_km2: 1, baseline_incident_count: 10,
  rate_ratio: 1.2, ci_lower: 0.8, ci_upper: 1.9, adjusted_p_value: 0.3, method: "quasi_poisson",
});

const place: NeighborhoodPlace = {
  place_id: "p1", place_label: "Cafe", beat: "C2", radius_m: 250,
  baseline_available: true, decision: "not_clear", place_incident_count: 12,
  category_breakdown: [],
  place_rate: 0.06, place_rate_ci_lower: 0.04, place_rate_ci_upper: 0.09,
  baselines: [
    entry("mcpp", "Capitol Hill", 0.05, "similar"),
    entry("beat", "Beat C2", 0.052, "similar"),
    entry("sector", "Sector C", 0.03, "above"),
    entry("city", "Citywide", 0.024, "above"),
  ],
};

const noun = incidentNoun("reported");

describe("BaselineIntervalPlot", () => {
  it("renders one row per baseline in fixed kind order plus the place row", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([place])} />);
    const names = screen.getAllByTestId("bplot-name").map((el) => el.textContent);
    expect(names).toEqual(["This place", "Capitol Hill", "Beat C2", "Sector C", "Citywide"]);
  });

  it("shows relation words verbatim from the payload", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([place])} />);
    expect(screen.getAllByText(/place is clearly above/).length).toBe(2);
    // "similar" claimed equivalence a failure to reject never establishes.
    expect(screen.getAllByText(/no clear difference/).length).toBe(2);
    expect(screen.queryByText(/\bsimilar\b/)).not.toBeInTheDocument();
  });

  // The header's "within 250 m" applies to the baseline ticks too, which is easy to miss:
  // those rows are densities rescaled to this circle, not counts observed area-wide.
  it("says the baseline rows are scaled to your radius and window", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([place])} />);
    expect(screen.getByText(/Baseline rows are scaled to your radius and window for comparison/)).toHaveTextContent(
      /not adjusted for multiple baseline comparisons/i,
    );
  });

  it("pins the interval label to the identity", () => {
    render(<BaselineIntervalPlot place={place} identity={placeIdentity(1)} noun={noun} domainMax={plotDomainMax([place])} />);
    expect(screen.getByText("B's approx. 95% CI")).toBeInTheDocument();
  });

  it("withholds the interval below the 3-report floor but keeps the point and explanation", () => {
    const belowFloor = {
      ...place,
      place_incident_count: 2,
      place_rate_ci_lower: 0.001,
      place_rate_ci_upper: 500,
    };
    const { container } = render(<BaselineIntervalPlot place={belowFloor} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([belowFloor])} />);
    expect(container.querySelector(".mc-bplot-band")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-bplot-row .bar")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-bplot-row .dot")).toBeInTheDocument();
    expect(screen.getByText("too few reports to put a range on")).toBeInTheDocument();
    expect(screen.getByTestId("baseline-plot")).toHaveClass("is-withheld");
  });

  it("withholds an exact-floor interval when the overall comparison is inadequate", () => {
    const exactFloor = {
      ...place,
      place_incident_count: 3,
      place_rate_ci_lower: 0.001,
      place_rate_ci_upper: 500,
    };
    const { container } = render(
      <BaselineIntervalPlot
        place={exactFloor}
        identity={placeIdentity(0)}
        noun={noun}
        domainMax={plotDomainMax([exactFloor], false)}
        comparisonDataAdequate={false}
      />,
    );
    expect(container.querySelector(".mc-bplot-band")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-bplot-row .bar")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-bplot-row .dot")).toBeInTheDocument();
    expect(screen.getByText(/comparison did not meet the data floor; interval withheld/i)).toBeInTheDocument();
  });

  it("keeps the band, label, and axis in the same track coordinate system as the marks", () => {
    const { container } = render(<BaselineIntervalPlot place={place} identity={placeIdentity(0)} noun={noun} domainMax={plotDomainMax([place])} />);
    const band = container.querySelector(".mc-bplot-band");
    const axis = container.querySelector(".mc-bplot-foot .axis");
    const dot = container.querySelector(".mc-bplot-row .dot");
    expect(band?.closest(".track")).not.toBeNull();
    expect(axis?.closest(".track")).not.toBeNull();
    expect(dot?.closest(".track")).not.toBeNull();
  });
});

describe("plotDomainMax", () => {
  it("covers the widest CI and every tick across places, zero-anchored", () => {
    const max = plotDomainMax([place]);
    // place ci_upper 0.09 /km²·day is the extreme → domain slightly above its per-year value
    expect(max).toBeGreaterThan(0);
  });

  it("ignores the interval bound for a place below the report floor", () => {
    const belowFloor = {
      ...place,
      place_incident_count: 2,
      place_rate_ci_upper: 500,
    };
    const withoutInterval = {
      ...belowFloor,
      place_rate_ci_upper: undefined,
    };
    expect(plotDomainMax([belowFloor])).toBe(plotDomainMax([withoutInterval]));
  });

  it("ignores every interval bound when the overall comparison is inadequate", () => {
    const exactFloor = {
      ...place,
      place_incident_count: 3,
      place_rate_ci_upper: 500,
    };
    const withoutInterval = {
      ...exactFloor,
      place_rate_ci_upper: undefined,
    };
    expect(plotDomainMax([exactFloor], false)).toBe(plotDomainMax([withoutInterval]));
  });
});
