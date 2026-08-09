import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_RADIUS_M,
  MIN_ANALYSIS_RADIUS_M,
  parseAnalysisRadius,
} from "./analysisRadius";

describe("parseAnalysisRadius", () => {
  it("accepts a whole number of meters", () => {
    expect(parseAnalysisRadius("400")).toEqual({ meters: 400, error: null });
  });

  it("enforces the meter range", () => {
    expect(MIN_ANALYSIS_RADIUS_M).toBe(100);
    expect(MAX_ANALYSIS_RADIUS_M).toBe(1000);
    expect(parseAnalysisRadius("99").error).toBe("Choose a radius from 100 to 1,000 meters.");
    expect(parseAnalysisRadius("1001").error).toBe("Choose a radius from 100 to 1,000 meters.");
  });

  it("rejects units, decimals, and empty values", () => {
    expect(parseAnalysisRadius("").error).toBe("Enter a radius in meters.");
    expect(parseAnalysisRadius("400 meters").error).toBe("Enter a whole number of meters.");
    expect(parseAnalysisRadius("0.4 km").error).toBe("Enter a whole number of meters.");
    expect(parseAnalysisRadius("400.5").error).toBe("Enter a whole number of meters.");
  });
});
