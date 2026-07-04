// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CompareVerdict } from "./CompareVerdict";
import { incidentNoun } from "../lib/layerCopy";
import type { CompareCallout } from "../lib/compareVerdict";

const base: CompareCallout = { kind: "clear", lowestLabel: "Pike", loweredCount: 2, otherCount: 2, caveatText: "not enough data here" };

afterEach(cleanup);

describe("CompareVerdict", () => {
  it("clear: names the lowest and says lower than every other", () => {
    render(<CompareVerdict callout={base} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/Pike/)).toBeInTheDocument();
    expect(screen.getByText(/statistically lower than every other/i)).toBeInTheDocument();
  });

  it("partial: says lower than N of the M others", () => {
    render(<CompareVerdict callout={{ ...base, kind: "partial", loweredCount: 1, otherCount: 3 }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/lower than 1 of the 3 other addresses/i)).toBeInTheDocument();
  });

  it("none: no statistically clear difference", () => {
    render(<CompareVerdict callout={{ ...base, kind: "none" }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/no statistically clear difference/i)).toBeInTheDocument();
  });

  it("inconclusive: leads with the caveat text", () => {
    render(<CompareVerdict callout={{ ...base, kind: "inconclusive" }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/not enough data here/i)).toBeInTheDocument();
  });

  it("uses the layer noun (911 calls)", () => {
    render(<CompareVerdict callout={base} noun={incidentNoun("calls")} />);
    expect(screen.getByText(/911 call rate/i)).toBeInTheDocument();
  });

  it("never emits safety-ranking vocabulary", () => {
    for (const kind of ["clear", "partial", "none", "inconclusive"] as const) {
      cleanup();
      render(<CompareVerdict callout={{ ...base, kind }} noun={incidentNoun("reported")} />);
      const text = (screen.getByTestId("compare-callout").textContent ?? "").toLowerCase();
      for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
        expect(text).not.toContain(banned);
      }
    }
  });
});
