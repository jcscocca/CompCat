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

import { type RoutesSavedView } from "./savedView";

describe("savedView routes variant", () => {
  const view: RoutesSavedView = {
    tab: "routes",
    origin: { latitude: 47.62, longitude: -122.33, label: "Home" },
    destination: { latitude: 47.61, longitude: -122.34, label: "Office" },
    mode: "transit",
    radiusM: 500,
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    layer: "calls",
  };

  it("round-trips a routes view", () => {
    expect(decodeView(encodeView(view))).toEqual(view);
  });

  it("rejects an endpoint outside the Seattle bbox", () => {
    const bad = { ...view, destination: { latitude: 40.0, longitude: -74.0, label: "NYC" } };
    expect(decodeView(encodeView(bad))).toBeNull();
  });

  it("rejects an unknown mode", () => {
    const encoded = encodeView({ ...view, mode: "teleport" as unknown as RoutesSavedView["mode"] });
    expect(decodeView(encoded)).toBeNull();
  });

  it("rejects a routes view missing an endpoint", () => {
    const wire = { v: 1, t: "routes", o: { y: 47.62, x: -122.33, l: "Home" }, m: "transit", r: 500, s: "a", e: "b", ly: "reported" };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(wire)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeView(encoded)).toBeNull();
  });
});
