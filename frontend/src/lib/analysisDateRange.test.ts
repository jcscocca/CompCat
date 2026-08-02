import { describe, expect, it } from "vitest";

import {
  analysisDateRangeError,
  DATE_RANGE_SPAN_ERROR,
  isValidAnalysisDateRange,
  maxAnalysisDate,
} from "./analysisDateRange";

const NOW = new Date("2026-08-01T12:00:00Z");

describe("analysis date range API contract", () => {
  it("accepts an ordered in-bounds window", () => {
    expect(analysisDateRangeError("2026-01-01", "2026-08-01", NOW)).toBeNull();
    expect(isValidAnalysisDateRange("2024-01-01", "2024-12-31")).toBe(true);
  });

  it("rejects malformed and reversed calendar dates", () => {
    expect(analysisDateRangeError("2026-02-31", "2026-03-01", NOW)).toMatch(/start date/i);
    expect(analysisDateRangeError("2026-08-02", "2026-08-01", NOW)).toMatch(/start date/i);
  });

  it("rejects a window longer than the API's 3000-day cap", () => {
    expect(analysisDateRangeError("2018-01-01", "2026-08-01", NOW)).toBe(
      DATE_RANGE_SPAN_ERROR,
    );
  });

  it("rejects dates before the product floor or after the API lookahead ceiling", () => {
    expect(analysisDateRangeError("2017-12-31", "2018-01-01", NOW)).toMatch(
      /between 2018-01-01/,
    );
    expect(analysisDateRangeError("2026-08-01", "9999-12-31", NOW)).toMatch(
      new RegExp(maxAnalysisDate(NOW)),
    );
  });
});
