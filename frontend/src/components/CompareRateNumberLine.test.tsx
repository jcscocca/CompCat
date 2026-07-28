// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompareRateNumberLine } from "./CompareRateNumberLine";
import type { CompareVerdictRow } from "../lib/compareVerdict";

const noun = { singular: "reported incident", plural: "reported incidents", pluralCap: "Reported incidents" };

function row(
  label: string,
  rel: CompareVerdictRow["relationship"],
  rate: number,
  lo: number | null,
  hi: number | null,
  rank: number,
): CompareVerdictRow {
  return {
    rank, optionId: label, label, incidentCount: 10, rate, barFraction: 0.5,
    multipleOfLowest: null,
    rateCiLow: lo, rateCiHigh: hi, relationship: rel, pairwise: null,
  };
}

const rows: CompareVerdictRow[] = [
  row("Pike", "lowest", 3.9, 2.7, 5.6, 1),
  row("Bell", "similar", 4.4, 3.0, 6.4, 2),
  row("Yesler", "higher", 14.3, 11.1, 18.4, 3),
];

afterEach(cleanup);

describe("CompareRateNumberLine", () => {
  it("renders a labeled row and rate for every place, lowest included", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    const plot = screen.getByTestId("compare-numberline");
    expect(within(plot).getByText("Pike")).toBeInTheDocument();
    expect(within(plot).getByText("Bell")).toBeInTheDocument();
    expect(within(plot).getByText("Yesler")).toBeInTheDocument();
    // rate is shown as expected incidents/year within the buffer, not the raw per-km²-day figure
    expect(within(plot).getByText(/reported incidents per year within 250 m/i)).toBeInTheDocument();
    expect(plot.querySelectorAll(".mc-plot-row .dot")).toHaveLength(3);
  });

  it("draws an interval bar per place, but only a dot when the rate CI is absent", () => {
    const withMissing: CompareVerdictRow[] = [
      row("Pike", "lowest", 3.9, 2.7, 5.6, 1),
      row("Gap", "limited", 9.0, null, null, 2),
    ];
    render(<CompareRateNumberLine rows={withMissing} noun={noun} radiusM={250} />);
    expect(screen.getByTestId("compare-numberline").querySelectorAll(".mc-plot-row .bar")).toHaveLength(1);
  });

  it("draws lowest-rate reference guides (same-as-lowest + effect floor)", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    const plot = screen.getByTestId("compare-numberline");
    expect(plot.querySelectorAll(".mc-plot-line")).toHaveLength(2);
    expect(within(plot).getByText(/marks the lowest place’s rate/i)).toBeInTheDocument();
  });

  it("defers to the ranked verdict in an honesty footnote", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    expect(within(screen.getByTestId("compare-numberline")).getByText(/ranked verdict above is authoritative/i)).toBeInTheDocument();
  });

  it("never emits safety-ranking vocabulary", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    const text = (screen.getByTestId("compare-numberline").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
