// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompareRankedList } from "./CompareRankedList";
import { incidentNoun } from "../lib/layerCopy";
import type { CompareVerdictRow } from "../lib/compareVerdict";
import type { SitePairwiseResult } from "../types";

const pair: SitePairwiseResult = {
  id: "a-b", option_a_id: "a", option_a_label: "Pike", option_b_id: "b", option_b_label: "Bell",
  winner_option_id: "a", winner_label: "Pike", decision_class: "statistically_lower", method: "quasipoisson",
  incident_count_a: 12, incident_count_b: 31, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days",
  rate_a: 3.9, rate_b: 10.1, rate_ratio: 2.6, ci_lower: 1.4, ci_upper: 4.9, p_value: 0.001, adjusted_p_value: 0.004,
  overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "",
};

const rows: CompareVerdictRow[] = [
  { rank: 1, optionId: "a", label: "Pike", incidentCount: 12, rate: 3.9, barFraction: 0.27, multipleOfLowest: null, relationship: "lowest", pairwise: null },
  { rank: 2, optionId: "b", label: "Bell", incidentCount: 31, rate: 10.1, barFraction: 0.71, multipleOfLowest: 2.6, relationship: "higher", pairwise: pair },
];

afterEach(cleanup);

describe("CompareRankedList", () => {
  it("renders rows in order with rank, label, count, rate and chips", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const region = screen.getByTestId("compare-ranked");
    expect(within(region).getByText("Pike")).toBeInTheDocument();
    expect(within(region).getByText("lowest rate")).toBeInTheDocument();
    expect(within(region).getByText("clearly higher")).toBeInTheDocument();
    expect(within(region).getByText(/2\.6× lowest/)).toBeInTheDocument();
    expect(within(region).getByText(/12 reported incidents/)).toBeInTheDocument();
  });

  it("shows a How-we-know disclosure only for non-lowest rows", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const region = screen.getByTestId("compare-ranked");
    const details = within(region).getAllByText("How we know");
    expect(details).toHaveLength(1);
    expect(within(region).getByText(/0\.004/)).toBeInTheDocument(); // adjusted p
  });

  it("never emits safety-ranking vocabulary", () => {
    render(<CompareRankedList rows={rows} noun={incidentNoun("reported")} radiusM={250} />);
    const text = (screen.getByTestId("compare-ranked").textContent ?? "").toLowerCase();
    for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
      expect(text).not.toContain(banned);
    }
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
});
