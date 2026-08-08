import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_RADIUS_M,
  MIN_ANALYSIS_RADIUS_M,
  parseAnalysisRadius,
} from "./analysisRadius";

describe("parseAnalysisRadius", () => {
  it.each([
    ["400", 400],
    ["400m", 400],
    ["400 meters", 400],
    ["0.4 km", 400],
    ["1300 ft", 396],
    ["¼ mile", 402],
    ["1/4 mi", 402],
  ])("normalizes %s to integer meters", (input, meters) => {
    expect(parseAnalysisRadius(input)).toEqual({ meters, error: null });
  });

  it("enforces the focused place-context range", () => {
    expect(MIN_ANALYSIS_RADIUS_M).toBe(100);
    expect(MAX_ANALYSIS_RADIUS_M).toBe(1000);
    expect(parseAnalysisRadius("99 m").error).toMatch(/100 m to 1 km/i);
    expect(parseAnalysisRadius("1.1 km").error).toMatch(/100 m to 1 km/i);
  });

  it("explains empty and malformed values", () => {
    expect(parseAnalysisRadius("").error).toBe("Enter a radius.");
    expect(parseAnalysisRadius("nearby").error).toMatch(/such as 400 m/i);
  });
});
