// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrendSection } from "./TrendSection";
import type { BaselineEntry, LayerKey, NeighborhoodAnalysis, NeighborhoodPlace, TrendsResponse } from "../types";

const getTrends = vi.fn();
vi.mock("../api/client", () => ({
  getTrends: (...args: unknown[]) => getTrends(...args),
}));

const VERDICT_VOCAB = /\b(safe|unsafe|danger\w*|risk\w*|improv\w*|worsen\w*|worse|better)\b/i;

function mcppBaseline(label: string): BaselineEntry {
  return {
    kind: "mcpp",
    label,
    area_km2: 2.1,
    baseline_incident_count: 500,
    baseline_rate: 0.2,
    rate_ratio: 1.0,
    ci_lower: 0.8,
    ci_upper: 1.3,
    adjusted_p_value: 0.5,
    method: "quasi_poisson",
    relation: "similar",
  };
}

function placeWithMcpp(id: string, label: string): NeighborhoodPlace {
  return {
    place_id: id,
    place_label: id,
    beat: "M2",
    radius_m: 250,
    baseline_available: true,
    decision: "not_clear",
    place_incident_count: 3,
    baselines: [mcppBaseline(label)],
    category_breakdown: [],
  };
}

function neighborhood(...labels: string[]): NeighborhoodAnalysis {
  return {
    radius_m: 250,
    analysis_start_date: "2021-07-01",
    analysis_end_date: "2026-06-30",
    offense_category: null,
    pairwise: [],
    places: labels.map((l, i) => placeWithMcpp(`n${i}`, l)),
  };
}

function months(n: number): string[] {
  const out: string[] = [];
  let y = 2021;
  let m = 7;
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function trends(over: Partial<TrendsResponse> = {}): TrendsResponse {
  const ms = over.months ?? months(60);
  return {
    layer: "reported",
    mcpp: "TEST HILL",
    mcpp_label: "Test Hill",
    category: null,
    months: ms,
    area_counts: ms.map((_, i) => 10 + (i % 5)),
    citywide_counts: ms.map((_, i) => 900 + (i % 7)),
    ...over,
  };
}

beforeEach(() => {
  getTrends.mockReset().mockResolvedValue(trends());
});
afterEach(cleanup);

function renderSection(props: { neighborhood: NeighborhoodAnalysis; layer?: LayerKey; category?: string | null }) {
  return render(
    <TrendSection
      neighborhood={props.neighborhood}
      layer={props.layer ?? "reported"}
      category={props.category ?? null}
    />,
  );
}

describe("TrendSection", () => {
  it("renders the reported title and subtitle", async () => {
    renderSection({ neighborhood: neighborhood("Test Hill") });
    expect(screen.getByText("Reported incident volume over time")).toBeInTheDocument();
    await screen.findByTestId("trend-chart");
    expect(screen.getByText(/last 5 years · monthly/)).toBeInTheDocument();
  });

  it("labels the calls window as a data floor", async () => {
    getTrends.mockResolvedValue(trends({ layer: "calls", months: months(24) }));
    renderSection({ neighborhood: neighborhood("Test Hill"), layer: "calls" });
    expect(screen.getByText("911 call volume over time")).toBeInTheDocument();
    await screen.findByTestId("trend-chart");
    expect(screen.getByText(/last 24 months — data floor/)).toBeInTheDocument();
  });

  it("shows both the index and count footnotes", async () => {
    renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByTestId("trend-chart");
    expect(screen.getByText(/direction, not magnitude/)).toBeInTheDocument();
    expect(screen.getByText(/not verified events/)).toBeInTheDocument();
  });

  it("offers a chip per MCPP and refetches on switch", async () => {
    renderSection({ neighborhood: neighborhood("Test Hill", "Ballard") });
    await screen.findByTestId("trend-chart");
    const ballard = screen.getByRole("button", { name: "Ballard" });
    expect(screen.getByRole("button", { name: "Test Hill" })).toBeInTheDocument();
    fireEvent.click(ballard);
    await waitFor(() => {
      expect(getTrends.mock.calls.some((c) => c[0].mcpp === "Ballard")).toBe(true);
    });
  });

  it("suppresses the citywide overlay when the anchor period is empty", async () => {
    const ms = months(60);
    getTrends.mockResolvedValue(
      trends({ months: ms, area_counts: ms.map((_, i) => (i < 12 ? 0 : 5)) }),
    );
    renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByTestId("trend-chart");
    expect(screen.queryByTestId("trend-city")).not.toBeInTheDocument();
    // The factor is undefined, not merely imprecise — say what is actually missing.
    expect(
      screen.getByText(/No incidents in the first 12 months of this window, so there's nothing to anchor the citywide line to\./),
    ).toBeInTheDocument();
  });

  // The series covers the whole MCPP; without this the reader takes it for their radius.
  it("labels the trend as neighborhood-level and wider than the radius", async () => {
    getTrends.mockResolvedValue(trends({ months: months(60) }));
    renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByTestId("trend-chart");
    expect(screen.getByText(/Neighborhood-level trend \(Test Hill\) — wider than your radius\./)).toBeInTheDocument();
  });

  it("shows raw counts only for a short window", async () => {
    getTrends.mockResolvedValue(trends({ months: months(10) }));
    renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByTestId("trend-chart");
    expect(screen.queryByTestId("trend-city")).not.toBeInTheDocument();
    expect(screen.getByText(/Not enough complete months/)).toBeInTheDocument();
  });

  it("renders nothing when no place has an MCPP", () => {
    const hood = neighborhood("Test Hill");
    hood.places[0].baselines = [];
    const { container } = render(<TrendSection neighborhood={hood} layer="reported" category={null} />);
    expect(container.firstChild).toBeNull();
    expect(getTrends).not.toHaveBeenCalled();
  });

  it("never uses verdict vocabulary in any rendered state", async () => {
    // valid overlay
    const valid = renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByTestId("trend-chart");
    expect(valid.container.textContent ?? "").not.toMatch(VERDICT_VOCAB);
    cleanup();

    // suppressed overlay
    const ms = months(60);
    getTrends.mockResolvedValue(trends({ months: ms, area_counts: ms.map((_, i) => (i < 12 ? 0 : 5)) }));
    const suppressed = renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByTestId("trend-chart");
    expect(suppressed.container.textContent ?? "").not.toMatch(VERDICT_VOCAB);
    cleanup();

    // error state
    getTrends.mockReset().mockRejectedValue(new Error("trend fetch failed"));
    const errored = renderSection({ neighborhood: neighborhood("Test Hill") });
    await screen.findByRole("alert");
    expect(errored.container.textContent ?? "").not.toMatch(VERDICT_VOCAB);
  });
});
