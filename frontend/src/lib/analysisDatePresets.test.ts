import { describe, expect, it } from "vitest";

import { analysisDatePresetWindow } from "./analysisDatePresets";

describe("analysisDatePresetWindow", () => {
  it("builds inclusive rolling windows ending on the active data date", () => {
    expect(analysisDatePresetWindow("30-days", "2026-07-31")).toEqual({
      startDate: "2026-07-02",
      endDate: "2026-07-31",
    });
    expect(analysisDatePresetWindow("90-days", "2026-07-31")).toEqual({
      startDate: "2026-05-03",
      endDate: "2026-07-31",
    });
  });

  it("builds the year-to-date window and rejects malformed anchors", () => {
    expect(analysisDatePresetWindow("year", "2026-07-31")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-07-31",
    });
    expect(analysisDatePresetWindow("30-days", "not-a-date")).toBeNull();
  });
});
