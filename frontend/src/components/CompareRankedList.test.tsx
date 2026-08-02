// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareRankedList } from "./CompareRankedList";
import { incidentNoun } from "../lib/layerCopy";
import type { CompareVerdictRow } from "../lib/compareVerdict";
import type { SitePairwiseResult } from "../types";

const pair: SitePairwiseResult = {
  id: "a-b", option_a_id: "a", option_a_label: "Pike", option_b_id: "b", option_b_label: "Bell",
  winner_option_id: "a", winner_label: "Pike", decision_class: "statistically_lower", method: "quasipoisson",
  incident_count_a: 10, incident_count_b: 31, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days",
  rate_a: 10, rate_b: 31, rate_ratio: 10 / 31, ci_lower: 0.145, ci_upper: 0.718, p_value: 0.001, adjusted_p_value: 0.004,
  overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "",
};

const rows: CompareVerdictRow[] = [
  { rank: 1, optionId: "a", label: "Pike", incidentCount: 10, rate: 10, barFraction: 10 / 31, multipleOfLowest: null, relationship: "lowest", pairwise: null },
  { rank: 2, optionId: "b", label: "Bell", incidentCount: 31, rate: 31, barFraction: 1, multipleOfLowest: 3.1, relationship: "higher", pairwise: pair },
];

afterEach(cleanup);

describe("CompareRankedList", () => {
  it("renders rows in order with rank, label, count, rate and chips", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("Pike")).toBeInTheDocument();
    expect(within(region).getByText("lower observed rate")).toBeInTheDocument();
    expect(within(region).getByText("statistically higher rate")).toBeInTheDocument();
    expect(within(region).getByText(/3\.1× the other observed rate/)).toBeInTheDocument();
    expect(region).not.toHaveTextContent(/lowest|clearly higher/i);
    expect(within(region).getByText(/10 reported incidents/)).toBeInTheDocument();
  });

  it("keeps the descriptive lowest-rate chip visually neutral", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    expect(screen.getByText("lower observed rate")).not.toHaveClass("clear");
  });

  it("keeps superlative wording for comparisons of three or more places", () => {
    const middle = { ...rows[1], barFraction: 31 / 44 };
    const third = {
      ...rows[1],
      rank: 3,
      optionId: "c",
      label: "Yesler",
      incidentCount: 44,
      rate: 44,
      barFraction: 1,
      multipleOfLowest: 4.4,
      pairwise: {
        ...pair,
        id: "a-c",
        option_b_id: "c",
        option_b_label: "Yesler",
        incident_count_b: 44,
        rate_b: 44,
        rate_ratio: 10 / 44,
        ci_lower: 0.1,
        ci_upper: 0.5,
      },
    };
    render(<CompareRankedList rows={[rows[0], middle, third]} noun={incidentNoun("reported")} radiusM={250} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("lowest observed rate")).toBeInTheDocument();
    expect(within(region).getByText(/3\.1× the lowest observed rate/)).toBeInTheDocument();
    expect(within(region).getByText(/4\.4× the lowest observed rate/)).toBeInTheDocument();
    expect(within(region).getAllByText("statistically higher than lowest")).toHaveLength(2);
  });

  it("keeps a large observed multiple separate from an unclear statistical result", () => {
    const unclearPair: SitePairwiseResult = {
      ...pair,
      decision_class: "not_statistically_clear",
      winner_option_id: null,
      winner_label: null,
      ci_lower: 0.2,
      ci_upper: 1.2,
      adjusted_p_value: 0.18,
    };
    render(
      <CompareRankedList
        rows={[
          rows[0],
          {
            ...rows[1],
            multipleOfLowest: 3.1,
            relationship: "similar",
            pairwise: unclearPair,
          },
        ]}
        noun={incidentNoun("reported")}
        radiusM={250}
      />,
    );
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText(/3\.1× the other observed rate/)).toBeInTheDocument();
    expect(within(region).getByText("no statistically clear difference")).toBeInTheDocument();
    expect(region).not.toHaveTextContent(/statistically higher rate|clearly higher/i);
  });

  it("does not call either observed rate lower when two rates tie", () => {
    render(
      <CompareRankedList
        rows={[
          rows[0],
          {
            ...rows[1],
            rate: rows[0].rate,
            multipleOfLowest: 1,
            relationship: "similar",
            pairwise: {
              ...pair,
              decision_class: "not_statistically_clear",
              winner_option_id: null,
              winner_label: null,
              rate_b: rows[0].rate,
              rate_ratio: 1,
              ci_lower: 0.7,
              ci_upper: 1.4,
              adjusted_p_value: 0.9,
            },
          },
        ]}
        noun={incidentNoun("reported")}
        radiusM={250}
      />,
    );
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("same observed rate")).toBeInTheDocument();
    expect(within(region).getByText(/1\.0× the other observed rate/)).toBeInTheDocument();
    expect(region).not.toHaveTextContent(/lower observed rate/i);
  });

  it("shows a How-we-know disclosure only for non-lowest rows", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const region = screen.getByTestId("compare-ranked");
    const details = within(region).getAllByText("How we know");
    expect(details).toHaveLength(1);
    expect(within(region).getByText("rate vs the other observed rate")).toBeInTheDocument();
    expect(within(region).getByText("3.10×")).toBeInTheDocument();
    expect(within(region).getByText("1.39–6.90")).toBeInTheDocument();
    expect(within(region).getByText(/0\.004/)).toBeInTheDocument(); // adjusted p
  });

  it("never emits safety-ranking vocabulary", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const text = (screen.getByTestId("compare-ranked").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("names the method and the data floor in words, not enum identifiers", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("met")).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/_/); // no raw snake_case identifiers on screen
  });

  // The engine returns a placeholder row (1.0x, CI 1.0-1.0, p 1.0) for a pair below the data
  // floor. Printing it claims a precisely measured "no difference" that was never computed.
  it("renders dashes, not fabricated 1.0s, for a pair that was never tested", () => {
    const untested: SitePairwiseResult = {
      ...pair,
      decision_class: "not_statistically_clear",
      winner_option_id: null,
      winner_label: null,
      method: "not_tested_minimum_data",
      minimum_data_status: "combined_count_too_low",
      rate_ratio: 1.0, ci_lower: 1.0, ci_upper: 1.0, p_value: 1.0, adjusted_p_value: 1.0,
    };
    render(
      <CompareRankedList
        rows={[rows[0], { ...rows[1], relationship: "limited", pairwise: untested }]}
        noun={incidentNoun("reported")}
        radiusM={250}
      />,
    );
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("not tested — below the data floor")).toBeInTheDocument();
    expect(within(region).getByText("fewer than 10 incidents combined")).toBeInTheDocument();
    expect(within(region).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(region.textContent).not.toContain("1.00×");
    expect(region.textContent).not.toContain("1.00–1.00");
    expect(region.textContent).not.toContain("1.000");
  });

  it("renders a Full context disclosure only for rows with an expansion", () => {
    const expansions = new Map([["b", <p key="x">Bell context body</p>]]);
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} expansionByOptionId={expansions} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getAllByText("Full context")).toHaveLength(1);
    expect(within(region).getByText("Bell context body")).toBeInTheDocument();
  });

  it("renders no Full context disclosure when no expansions are provided", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    expect(within(screen.getByTestId("compare-ranked")).queryByText("Full context")).not.toBeInTheDocument();
  });

  it("fires onHoverRow with the row's option id on enter and null on leave", () => {
    const onHoverRow = vi.fn();
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} onHoverRow={onHoverRow} />);
    const first = screen.getByTestId("compare-ranked").querySelectorAll(".mc-ranked-row")[0]!;
    fireEvent.mouseEnter(first);
    expect(onHoverRow).toHaveBeenCalledWith(rows[0].optionId);
    fireEvent.mouseLeave(first);
    expect(onHoverRow).toHaveBeenLastCalledWith(null);
  });
});
