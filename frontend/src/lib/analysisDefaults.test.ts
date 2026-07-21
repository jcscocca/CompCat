import { describe, expect, it } from "vitest";
import { ANALYSIS_MIN_DATE, availableDataAnalysisWindow, currentYearAnalysisWindow } from "./analysisDefaults";

describe("analysis window", () => {
  it("exposes a 2018-01-01 floor", () => {
    expect(ANALYSIS_MIN_DATE).toBe("2018-01-01");
  });
  it("never starts before the floor", () => {
    const w = currentYearAnalysisWindow(new Date("2017-05-01T00:00:00"));
    expect(w.analysis_start_date >= ANALYSIS_MIN_DATE).toBe(true);
  });

  it("uses the freshest available data year instead of the wall-clock year", () => {
    expect(availableDataAnalysisWindow({ data_through: "2025-10-27", earliest: "2018-01-01" })).toEqual({
      analysis_start_date: "2025-01-01",
      analysis_end_date: "2025-10-27",
    });
  });

  it("clamps the start to a layer that began during the available year", () => {
    expect(availableDataAnalysisWindow({ data_through: "2025-10-27", earliest: "2025-07-12" })).toEqual({
      analysis_start_date: "2025-07-12",
      analysis_end_date: "2025-10-27",
    });
  });

  it("returns null when the layer has no usable freshness date", () => {
    expect(availableDataAnalysisWindow({ data_through: null })).toBeNull();
  });
});
