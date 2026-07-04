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
    multipleOfLowest: null, plotCiLow: null, plotCiHigh: null,
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
  it("renders a labeled row and rate for every address, lowest included", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} />);
    const plot = screen.getByTestId("compare-numberline");
    expect(within(plot).getByText("Pike")).toBeInTheDocument();
    expect(within(plot).getByText("Bell")).toBeInTheDocument();
    expect(within(plot).getByText("Yesler")).toBeInTheDocument();
    expect(within(plot).getByText("14.3")).toBeInTheDocument();
    expect(plot.querySelectorAll(".mc-plot-row .dot")).toHaveLength(3);
  });

  it("draws an interval bar per address, but only a dot when the rate CI is absent", () => {
    const withMissing: CompareVerdictRow[] = [
      row("Pike", "lowest", 3.9, 2.7, 5.6, 1),
      row("Gap", "limited", 9.0, null, null, 2),
    ];
    render(<CompareRateNumberLine rows={withMissing} noun={noun} />);
    expect(screen.getByTestId("compare-numberline").querySelectorAll(".mc-plot-row .bar")).toHaveLength(1);
  });

  it("defers to the ranked verdict in an honesty footnote", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} />);
    expect(within(screen.getByTestId("compare-numberline")).getByText(/ranked verdict above is authoritative/i)).toBeInTheDocument();
  });

  it("never emits safety-ranking vocabulary", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} />);
    const text = (screen.getByTestId("compare-numberline").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
