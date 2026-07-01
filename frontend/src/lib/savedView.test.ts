import { describe, expect, it } from "vitest";

import { decodeView, encodeView, type SavedView } from "./savedView";

const VIEW: SavedView = {
  tab: "analyze",
  points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
  radiusM: 250,
  startDate: "2024-01-01",
  endDate: "2024-01-31",
  layer: "reported",
  offenseCategory: "",
};

describe("savedView", () => {
  it("round-trips a view through encode/decode", () => {
    expect(decodeView(encodeView(VIEW))).toEqual(VIEW);
  });

  it("returns null for malformed input", () => {
    expect(decodeView("not-base64!!")).toBeNull();
    expect(decodeView("")).toBeNull();
  });

  it("returns null for an unknown version", () => {
    const bad = btoa(JSON.stringify({ v: 99, tab: "analyze" }));
    expect(decodeView(bad)).toBeNull();
  });

  it("returns null when a point label is not a string", () => {
    const bad = btoa(JSON.stringify({
      v: 1, t: "analyze", pts: [{ y: 47.6, x: -122.3, l: 5 }],
      r: 250, s: "2024-01-01", e: "2024-01-31", ly: "reported", c: null,
    }));
    expect(decodeView(bad)).toBeNull();
  });
});
