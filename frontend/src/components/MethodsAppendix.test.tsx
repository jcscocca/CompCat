// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MethodsAppendix } from "./MethodsAppendix";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

afterEach(cleanup);

describe("MethodsAppendix", () => {
  it("opens from the Methods button and lists every definition", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    for (const def of METHODS_DEFINITIONS) {
      expect(screen.getByText(def.term)).toBeInTheDocument();
    }
  });

  it("defines NIBRS in the appendix", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    expect(screen.getByText("NIBRS group")).toBeInTheDocument();
    expect(screen.getByText(/National Incident-Based Reporting System/)).toBeInTheDocument();
  });

  it("every measure id is unique", () => {
    const ids = METHODS_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// Each of these was checked against the engine; they are the claims the appendix is allowed
// to make, so pin them rather than letting the prose drift back.
describe("methods definitions match the engine", () => {
  const byId = new Map(METHODS_DEFINITIONS.map((d) => [d.id, d]));

  it("states the rate as a per-year extrapolation, not an observed count", () => {
    const rate = byId.get("reportedIncidentRate")!;
    expect(rate.shownAs).toBe("12 /yr");
    expect(rate.plain).toMatch(/extrapolation, not an observed count/);
    expect(rate.formula).toBe("per-year = incidents ÷ days × 365.25");
  });

  it("describes all four baselines and which of them exclude your radius", () => {
    const baseline = byId.get("beatBaselineRate")!;
    for (const term of ["neighborhood", "beat", "sector", "city"]) {
      expect(baseline.plain.toLowerCase()).toContain(term);
    }
    expect(baseline.plain).toMatch(/EXCLUDE the area inside your radius/);
    expect(baseline.plain).toMatch(/every neighborhood.*police beat.*circle touches/i);
    expect(baseline.plain).toMatch(/pooled/i);
    expect(baseline.plain).toMatch(/negligible/);
    // The window is user-selected; the baseline is not fixed to 2018-present.
    expect(baseline.plain).not.toMatch(/2018/);
  });

  it("says dispersion always widens and uses a Student-t multiplier", () => {
    const dispersion = byId.get("overdispersion")!;
    expect(dispersion.plain).toMatch(/never narrowing below plain Poisson/);
    expect(dispersion.plain).toMatch(/above φ 1\.2 the method is labeled quasi-Poisson/);
    expect(dispersion.plain).toMatch(/Student-t multiplier/);
  });

  it("lists the 3-incident place floor alongside the other withhold reasons", () => {
    const floors = byId.get("minimumDataStatus")!;
    expect(floors.plain).toMatch(/at least 30 days/);
    expect(floors.plain).toMatch(/at least 3 incidents/);
    expect(floors.plain).toMatch(/at least 10/);
    expect(floors.plain).toMatch(/baseline area is too small/);
    expect(floors.plain).toMatch(/non-positive exposure/);
    expect(floors.plain).toMatch(/too few months to fit/);
  });

  it("distinguishes the absolute-rate interval from the rate-ratio interval", () => {
    const absolute = byId.get("absoluteRateInterval")!;
    const ratio = byId.get("confidenceInterval")!;
    expect(absolute.term).toBe("Absolute-rate interval");
    expect(absolute.plain).toMatch(/one place's own reported-density rate/i);
    expect(absolute.plain).toMatch(/not the interval for a rate ratio/i);
    expect(ratio.term).toBe("Rate-ratio interval");
    expect(ratio.plain).toMatch(/ratio between a place and a comparator/i);
  });

  it("describes the calibrated approximate interval machinery honestly", () => {
    const interval = byId.get("confidenceInterval")!;
    expect(interval.plain).toMatch(/large-sample Wald.*log scale/i);
    expect(interval.plain).toMatch(/Student-t.*φ.*handful of months/i);
    expect(interval.plain).toMatch(/near, not exactly, 95%/i);
    expect(interval.plain).toMatch(/about 89%.*very bursty.*small counts/i);
    expect(interval.howToRead).toMatch(/not adjusted for multiple comparisons/i);
  });

  it("scopes BH to each run's families and separates baseline and across-place adjustments", () => {
    const bh = byId.get("adjustedPValue")!;
    expect(bh.plain).toMatch(/within each run/i);
    expect(bh.plain).toMatch(/up to four baselines/i);
    expect(bh.plain).toMatch(/separate adjustment across several places/i);
    expect(bh.plain).toMatch(/separate runs/i);
  });

  // The exact conditional Poisson p-value is computed server-side but never serialized into
  // any response, so documenting it described a number no reader could ever see.
  it("does not document the exact p-value, which never ships in a payload", () => {
    expect(byId.has("exactPValue")).toBe(false);
    expect(METHODS_DEFINITIONS.some((d) => /exact/i.test(d.term))).toBe(false);
  });

  it("warns that results are radius-dependent and that many looks inflate surprises", () => {
    expect(byId.get("radiusMatters")!.howToRead).toMatch(/250 m can legitimately differ at 1000 m/);
    expect(byId.get("manyLooks")!.plain).toMatch(/by chance/);
    expect(byId.get("manyLooks")!.howToRead).toMatch(/caution/);
  });

  it("calls the compare order descriptive and names the selected-lowest bias", () => {
    const ranking = byId.get("compareRanking")!;
    expect(ranking.plain).toMatch(/descriptive/i);
    expect(ranking.plain).toMatch(/selected after looking at the data/i);
    expect(ranking.plain).toMatch(/biased low/i);
    expect(ranking.howToRead).toMatch(/only.*statistically lower.*tested conclusion/i);
  });
});
