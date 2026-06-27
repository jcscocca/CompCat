// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutesTab } from "./RoutesTab";
import type { AnalysisSettings, RouteComparison } from "../types";

const analysis: AnalysisSettings = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 500, offenseCategory: "" };

const twoAlt: RouteComparison = {
  request: { id: "r1", origin: { label: "Capitol Hill" }, destination: { label: "Downtown Seattle" }, mode: "transit" },
  alternatives: [
    { id: "a1", route_label: "Link light rail via Westlake", rank: 1, duration_minutes: 14, distance_m: 2100, transfer_count: 0, walking_distance_m: 450, mode_mix: "walk,transit", summary_geometry: "47.61,-122.33;47.60,-122.34" },
    { id: "a2", route_label: "Pine Street bus", rank: 2, duration_minutes: 18, distance_m: 2200, transfer_count: 0, walking_distance_m: 500, mode_mix: "walk,bus", summary_geometry: "47.62,-122.32;47.60,-122.34" },
  ],
  context_summaries: [
    { route_alternative_id: "a1", radius_m: 500, incident_count: 4, nearest_incident_m: 40, offense_category: "PROPERTY", offense_subcategory: "THEFT" },
    { route_alternative_id: "a2", radius_m: 500, incident_count: 9, nearest_incident_m: 12, offense_category: "PROPERTY", offense_subcategory: "BURGLARY" },
  ],
  statistical_comparison: {
    overview: { decision_class: "statistically_lower", recommendation_option_id: "a1", recommendation_label: "Link light rail via Westlake", summary_text: "Link light rail via Westlake has a statistically lower reported-incident rate for the selected corridor.", caveat_text: "This describes reported incidents, not causation or personal outcomes." },
  },
};

const oneAlt: RouteComparison = {
  ...twoAlt,
  alternatives: [twoAlt.alternatives[0]],
  statistical_comparison: null,
};

afterEach(cleanup);

describe("RoutesTab", () => {
  it("renders the verdict and a block per alternative", () => {
    render(<RoutesTab analysis={analysis} running={false} result={twoAlt} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower reported-incident rate/i)).toBeInTheDocument();
    expect(screen.getByText("Link light rail via Westlake")).toBeInTheDocument();
    expect(screen.getByText("Pine Street bus")).toBeInTheDocument();
  });

  it("omits the verdict for a single route", () => {
    render(<RoutesTab analysis={analysis} running={false} result={oneAlt} onRun={vi.fn()} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("runs with the selected origin, destination, and mode", () => {
    const onRun = vi.fn();
    render(<RoutesTab analysis={analysis} running={false} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /compare routes/i }));
    expect(onRun).toHaveBeenCalledWith("Capitol Hill", "Downtown Seattle", "transit");
  });
});
