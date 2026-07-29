import { describe, expect, it } from "vitest";
import { CAVEAT_DATA_LIMITS, CAVEAT_HEADLINE, incidentNoun, layerDisclosure, resultCaveat, REVISED_CAVEAT } from "./layerCopy";

describe("incidentNoun arrests", () => {
  it("uses arrest nouns for the arrests layer", () => {
    expect(incidentNoun("arrests")).toEqual({ singular: "arrest", plural: "arrests", pluralCap: "Arrests" });
  });
});

describe("layerDisclosure", () => {
  it("has no disclosure for the reported layer", () => {
    expect(layerDisclosure("reported")).toBeNull();
  });

  it("returns the retired calls-layer disclosure verbatim", () => {
    expect(layerDisclosure("calls")).toBe(
      "911 calls are requests for service, not confirmed incidents. The same event can generate several calls, many are proactive officer activity, and a call does not mean a crime occurred. Counts below are call volume, not reported crime.",
    );
  });

  it("returns the retired arrests-layer disclosure verbatim", () => {
    expect(layerDisclosure("arrests")).toBe(
      "Arrests are enforcement activity, not reported incidents. An arrest is logged where the arrest was made — which may differ from where an offense occurred — and most reported crimes never result in one. Categories are a best-effort NIBRS crosswalk from the arrest offense.",
    );
  });
});

// One invariant phrasing everywhere: every surface either renders REVISED_CAVEAT or composes
// it from these two clauses, so no surface can paraphrase it into a different claim.
describe("product caveat", () => {
  it("composes the shipped caveat from its two clauses", () => {
    expect(REVISED_CAVEAT).toBe(`${CAVEAT_HEADLINE} ${CAVEAT_DATA_LIMITS}`);
  });

  it("carries the invariant phrasing, not a paraphrase", () => {
    expect(CAVEAT_HEADLINE).toBe("Reported incident context, not a personal risk prediction.");
    expect(REVISED_CAVEAT).not.toMatch(/safety advice/);
  });

  it("uses the active layer's nouns without calling 911 calls incidents", () => {
    const calls = resultCaveat(incidentNoun("calls"));
    expect(calls).toBe(
      "911 call context, not a personal risk prediction. Results use reported Seattle 911 call data, which can be incomplete, delayed, corrected, or geographically generalized.",
    );
    expect(calls).not.toMatch(/\bincident/i);
  });
});
