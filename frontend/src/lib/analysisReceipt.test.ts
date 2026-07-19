import { describe, expect, it } from "vitest";

import { describeAnalysisPatch } from "./analysisReceipt";
import type { AnalysisSettings } from "../types";

const base: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-07-19",
  radiusM: 250,
  offenseCategory: "",
  layer: "reported",
};

describe("describeAnalysisPatch", () => {
  it("describes a radius change", () => {
    expect(describeAnalysisPatch(base, { radiusM: 500 })).toBe("Search radius → 500 m");
  });

  it("describes a date-range change with the resulting range", () => {
    expect(describeAnalysisPatch(base, { startDate: "2026-03-01" })).toBe(
      "Date range → 2026-03-01 – 2026-07-19",
    );
  });

  it("describes a category change by label", () => {
    expect(describeAnalysisPatch(base, { offenseCategory: "PROPERTY" })).toBe(
      "Categories → Property",
    );
    expect(
      describeAnalysisPatch({ ...base, offenseCategory: "PROPERTY" }, { offenseCategory: "" }),
    ).toBe("Categories → All reported");
  });

  it("describes a layer change with the layer noun", () => {
    expect(describeAnalysisPatch(base, { layer: "arrests" })).toBe("Layer → Arrests");
  });

  it("joins multiple changes", () => {
    expect(describeAnalysisPatch(base, { radiusM: 1000, offenseCategory: "PERSON" })).toBe(
      "Search radius → 1000 m · Categories → Person",
    );
  });

  it("returns null when nothing effectively changes", () => {
    expect(describeAnalysisPatch(base, { radiusM: 250 })).toBeNull();
    expect(describeAnalysisPatch(base, {})).toBeNull();
  });
});
