import { describe, expect, it } from "vitest";
import { ANALYSIS_MIN_DATE, currentYearAnalysisWindow } from "./analysisDefaults";

describe("analysis window", () => {
  it("exposes a 2018-01-01 floor", () => {
    expect(ANALYSIS_MIN_DATE).toBe("2018-01-01");
  });
  it("never starts before the floor", () => {
    const w = currentYearAnalysisWindow(new Date("2017-05-01T00:00:00"));
    expect(w.analysis_start_date >= ANALYSIS_MIN_DATE).toBe(true);
  });
});
