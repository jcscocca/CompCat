// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlaceContextCard } from "./PlaceContextCard";
import { incidentNoun } from "../lib/layerCopy";
import type { NeighborhoodPlace } from "../types";

const homePlace: NeighborhoodPlace = {
  place_id: "p1", place_label: "Home", beat: "M2", radius_m: 250,
  baseline_available: true, decision: "above_clear", place_incident_count: 12,
  place_rate: 0.67, place_rate_ci_lower: 0.41, place_rate_ci_upper: 0.98,
  minimum_data_status: "met",
  nearest_incident_m: 42, monthly_counts: [1, 2, 1, 3, 2, 3],
  baselines: [
    { kind: "mcpp", label: "Capitol Hill", area_km2: 2.4, baseline_incident_count: 320, baseline_rate: 0.20, rate_ratio: 3.4, ci_lower: 2.1, ci_upper: 5.5, adjusted_p_value: 0.002, method: "quasi_poisson", relation: "above" },
    { kind: "beat", label: "Beat M2", area_km2: 1.1, baseline_incident_count: 180, baseline_rate: 0.17, rate_ratio: 4.0, ci_lower: 2.1, ci_upper: 7.6, adjusted_p_value: 0.002, method: "quasi_poisson", relation: "above" },
  ],
  category_breakdown: [
    { label: "Theft", place_count: 5, place_share: 0.71, beat_share: 0.20 },
    { label: "Assault", place_count: 2, place_share: 0.29, beat_share: null },
  ],
  temporal: {
    hour_by_dow: Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => (d <= 4 && h === 17 ? 4 : d === 5 && h === 2 ? 20 : 0)),
    ),
    hour_counts: Array.from({ length: 24 }, (_, h) => (h === 17 ? 20 : h === 2 ? 20 : 0)),
    dow_counts: [4, 4, 4, 4, 4, 20, 0],
    total_with_time: 40,
    without_time: 0,
  },
};

const noun = incidentNoun("reported");

afterEach(cleanup);

function renderCard(place: NeighborhoodPlace = homePlace) {
  return render(
    <PlaceContextCard
      place={place}
      index={0}
      windowLabel="2026-01-01 – 2026-06-30"
      noun={noun}
      domainMax={6}
      locator={null}
      coords={{ latitude: 47.61, longitude: -122.33 }}
    />,
  );
}

describe("PlaceContextCard", () => {
  it("renders the verdict region with the count sub-line", () => {
    renderCard();
    expect(screen.getByLabelText("Verdict for Home")).toBeInTheDocument();
    expect(screen.getByText(/12 reported incidents within 250 m/)).toBeInTheDocument();
  });

  it("shows baseline analytics behind How we know", () => {
    renderCard();
    const summary = screen.getByText("How we know");
    // Scope to the disclosure: the baseline label also appears in the interval plot.
    const details = summary.closest("details")!;
    expect(within(details).getByText("Capitol Hill")).toBeInTheDocument();
    expect(within(details).getAllByText("0.002").length).toBeGreaterThan(0);
  });

  it("renders the temporal profile with the travel-window callout", () => {
    renderCard();
    expect(screen.getByText(/When reported incidents occurred/i)).toBeInTheDocument();
    expect(screen.getByText(/of the 40 reported incidents with a recorded time/)).toBeInTheDocument();
  });

  it("renders category rows with place and beat shares", () => {
    renderCard();
    expect(screen.getByText("Theft")).toBeInTheDocument();
    expect(screen.getByText(/71% here · 20% nearby/)).toBeInTheDocument();
  });

  it("falls back cleanly when no beat baseline is available", () => {
    renderCard({ ...homePlace, baseline_available: false, baselines: [] });
    expect(screen.getByText(/12 reported incidents in range; no beat baseline/)).toBeInTheDocument();
  });

  it("never emits safety-ranking vocabulary", () => {
    const { container } = renderCard();
    const noBaseline = renderCard({ ...homePlace, baseline_available: false, baselines: [] });
    const text = `${container.textContent ?? ""} ${noBaseline.container.textContent ?? ""}`.toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
