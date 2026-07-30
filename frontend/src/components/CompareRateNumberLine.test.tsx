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

  it("withholds a supplied interval below the 3-report place floor and explains the dot", () => {
    const belowFloor = [
      { ...row("Tiny", "lowest", 3.9, 0.1, 500, 1), incidentCount: 2 },
      row("Bell", "similar", 4.4, 3.0, 6.4, 2),
    ];
    render(<CompareRateNumberLine rows={belowFloor} noun={noun} radiusM={250} />);
    const plot = screen.getByTestId("compare-numberline");
    const tiny = within(plot).getByText("Tiny").closest(".mc-plot-row")!;
    expect(tiny.querySelector(".bar")).not.toBeInTheDocument();
    expect(tiny.querySelector(".dot")).toBeInTheDocument();
    expect(within(tiny as HTMLElement).getByText("too few reports to put a range on")).toBeInTheDocument();
    expect(tiny).toHaveClass("is-withheld");
  });

  it("excludes a withheld interval bound from the axis domain", () => {
    const normal = rows.slice(0, 2);
    const inflatedWithheld = [
      ...normal,
      { ...row("Tiny", "limited", 3.9, 0.1, 500, 3), incidentCount: 2 },
    ];
    const { rerender } = render(<CompareRateNumberLine rows={normal} noun={noun} radiusM={250} />);
    const normalMax = screen.getByTestId("compare-numberline").querySelectorAll(".mc-plot-axis .tick")[2]?.textContent;
    rerender(<CompareRateNumberLine rows={inflatedWithheld} noun={noun} radiusM={250} />);
    const withheldMax = screen.getByTestId("compare-numberline").querySelectorAll(".mc-plot-axis .tick")[2]?.textContent;
    expect(withheldMax).toBe(normalMax);
  });

  it("withholds every interval when the overall comparison misses the data floor", () => {
    const inadequate = [
      { ...row("Tiny", "lowest", 3.9, 0.1, 500, 1), incidentCount: 2 },
      { ...row("Floor", "limited", 4.4, 0.1, 500, 2), incidentCount: 3 },
    ];
    render(
      <CompareRateNumberLine
        rows={inadequate}
        noun={noun}
        radiusM={250}
        comparisonDataAdequate={false}
      />,
    );
    const plot = screen.getByTestId("compare-numberline");
    expect(plot.querySelectorAll(".mc-plot-row .bar")).toHaveLength(0);
    expect(plot.querySelectorAll(".mc-plot-row .dot")).toHaveLength(2);
    expect(within(plot).getByText(/intervals withheld/i)).toBeInTheDocument();
    expect(within(plot).getByText(/comparison did not meet the data floor/i)).toBeInTheDocument();
    expect(within(plot).queryByText("500")).not.toBeInTheDocument();
  });

  it("draws lowest-rate reference guides (same-as-lowest + effect floor)", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    const plot = screen.getByTestId("compare-numberline");
    expect(plot.querySelectorAll(".mc-plot-line")).toHaveLength(2);
    expect(within(plot).getByText(/marks the lowest place’s rate/i)).toBeInTheDocument();
  });

  it("defers to the ranked verdict in an honesty footnote", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    const note = within(screen.getByTestId("compare-numberline")).getByText(/statistically tested verdict above is authoritative/i);
    expect(note).toHaveTextContent(/approximate 95% intervals/i);
    expect(note).toHaveTextContent(/not adjusted for multiple comparisons/i);
  });

  it("never emits safety-ranking vocabulary", () => {
    render(<CompareRateNumberLine rows={rows} noun={noun} radiusM={250} />);
    const text = (screen.getByTestId("compare-numberline").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });
});
