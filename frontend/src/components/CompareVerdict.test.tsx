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

  it("clear: uses comparative wording for exactly two places", () => {
    const { container } = render(
      <CompareVerdict
        callout={{ ...base, loweredCount: 1, otherCount: 1 }}
        noun={incidentNoun("reported")}
      />,
    );
    expect(container).toHaveTextContent(/has the lower reported incident rate/i);
    expect(container).toHaveTextContent(/statistically lower than the other place/i);
    expect(container).not.toHaveTextContent(/lowest|every other/i);
  });

  it("partial: says lower than N of the M others", () => {
    render(<CompareVerdict callout={{ ...base, kind: "partial", loweredCount: 1, otherCount: 3 }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/lower than 1 of the 3 other places/i)).toBeInTheDocument();
  });

  // "within normal variation" told the reader the remaining gaps were established as
  // ordinary; the test only failed to resolve them at this sample size.
  it("partial: attributes the unresolved rest to sample size, not to normality", () => {
    const { container } = render(<CompareVerdict callout={{ ...base, kind: "partial", loweredCount: 1, otherCount: 3 }} noun={incidentNoun("reported")} />);
    expect(container.textContent).toContain("For the rest, the difference isn't statistically clear at this sample size.");
    expect(container.textContent).not.toMatch(/normal variation/i);
  });

  it("none: no statistically clear difference", () => {
    render(<CompareVerdict callout={{ ...base, kind: "none" }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/no statistically clear difference/i)).toBeInTheDocument();
  });

  it("none: uses between-two wording for exactly two places", () => {
    const { container } = render(
      <CompareVerdict
        callout={{ ...base, kind: "none", loweredCount: 0, otherCount: 1 }}
        noun={incidentNoun("reported")}
      />,
    );
    expect(container).toHaveTextContent(/between these two places at this sample size/i);
    expect(container).not.toHaveTextContent(/across|none of the gaps/i);
  });

  it("none: attributes the gaps to sample size, not to normality", () => {
    const { container } = render(<CompareVerdict callout={{ ...base, kind: "none" }} noun={incidentNoun("reported")} />);
    expect(container.textContent).toContain("none of the gaps are statistically clear at this sample size.");
    expect(container.textContent).not.toMatch(/normal variation/i);
  });

  it("inconclusive: leads with the caveat text", () => {
    render(<CompareVerdict callout={{ ...base, kind: "inconclusive" }} noun={incidentNoun("reported")} />);
    expect(screen.getByText(/not enough data here/i)).toBeInTheDocument();
  });

  it("inconclusive: uses between-two wording for exactly two places", () => {
    const { container } = render(
      <CompareVerdict
        callout={{ ...base, kind: "inconclusive", loweredCount: 0, otherCount: 1 }}
        noun={incidentNoun("reported")}
      />,
    );
    expect(container).toHaveTextContent(/comparison between these two places/i);
    expect(container).not.toHaveTextContent(/comparison across these places/i);
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
