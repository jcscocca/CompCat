// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutesTab } from "./RoutesTab";
import type { AnalysisSettings, Place, RouteComparison } from "../types";

const analysis: AnalysisSettings = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 500, offenseCategory: "" };

const places: Place[] = [
  { id: "p1", display_label: "Home", latitude: 47.62, longitude: -122.33, visit_count: 1, total_dwell_minutes: null, inferred_place_type: "home", sensitivity_class: "normal" },
  { id: "p2", display_label: "Office", latitude: 47.61, longitude: -122.34, visit_count: 1, total_dwell_minutes: null, inferred_place_type: "work", sensitivity_class: "normal" },
];

const twoAlt: RouteComparison = {
  request: { id: "r1", origin: { label: "Home" }, destination: { label: "Office" }, mode: "transit" },
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

const oneAlt: RouteComparison = { ...twoAlt, alternatives: [twoAlt.alternatives[0]], statistical_comparison: null };
const noAlt: RouteComparison = { ...twoAlt, alternatives: [], context_summaries: [], statistical_comparison: null };

afterEach(cleanup);

describe("RoutesTab", () => {
  it("renders the verdict and a block per alternative", () => {
    render(<RoutesTab analysis={analysis} running={false} result={twoAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/statistically lower reported-incident rate/i)).toBeInTheDocument();
    expect(screen.getByText("Link light rail via Westlake")).toBeInTheDocument();
    expect(screen.getByText("Pine Street bus")).toBeInTheDocument();
  });

  it("omits the verdict for a single route", () => {
    render(<RoutesTab analysis={analysis} running={false} result={oneAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("shows a no-route message when there are zero alternatives", () => {
    render(<RoutesTab analysis={analysis} running={false} result={noAlt} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/no route found/i)).toBeInTheDocument();
  });

  it("lists saved places in the From and To pickers", () => {
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getAllByRole("option", { name: "Home" }).length).toBe(2);
    expect(screen.getAllByRole("option", { name: "Office" }).length).toBe(2);
  });

  it("runs with the selected place endpoints", () => {
    const onRun = vi.fn();
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={vi.fn()} onRun={onRun} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "place:p1" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "place:p2" } });
    fireEvent.click(screen.getByRole("button", { name: /compare routes/i }));
    expect(onRun).toHaveBeenCalledWith({ place_id: "p1" }, { place_id: "p2" }, "transit");
  });

  it("searches an address and makes it selectable", async () => {
    const geocodeSearch = vi.fn().mockResolvedValue([{ label: "400 Broad St", latitude: 47.62, longitude: -122.35, source: "nominatim" }]);
    render(<RoutesTab analysis={analysis} running={false} places={places} geocodeSearch={geocodeSearch} onRun={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/find an address/i), { target: { value: "400 Broad" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await screen.findAllByRole("option", { name: /400 Broad St/ });
    expect(geocodeSearch).toHaveBeenCalledWith("400 Broad");
  });
});
