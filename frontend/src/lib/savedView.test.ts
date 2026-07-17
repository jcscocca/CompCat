import { describe, expect, it } from "vitest";

import { decodeView, encodeView, type SavedView } from "./savedView";

const VIEW: SavedView = {
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

  it("returns null when the radius is not a valid in-range number", () => {
    const withRadius = (r: unknown) =>
      btoa(JSON.stringify({
        v: 1, t: "analyze", pts: [{ y: 47.6, x: -122.3, l: "P" }],
        r, s: "2024-01-01", e: "2024-01-31", ly: "reported", c: null,
      }));
    expect(decodeView(withRadius("abc"))).toBeNull(); // NaN would poison the number line
    expect(decodeView(withRadius(0))).toBeNull(); // non-positive
    expect(decodeView(withRadius(99999))).toBeNull(); // beyond the 5000 m cap
    expect(decodeView(withRadius(250))?.radiusM).toBe(250); // a valid radius still decodes
  });

  it("preserves the arrests layer through encode/decode", () => {
    const view = { points: [{ latitude: 47.6, longitude: -122.3, label: "P" }], radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31", layer: "arrests" as const, offenseCategory: "" };
    expect(decodeView(encodeView(view))?.layer).toBe("arrests");
  });

  it("encodes without a tab discriminator", () => {
    const encoded = encodeView({
      points: [{ latitude: 47.6, longitude: -122.33, label: "Home" }],
      radiusM: 250, startDate: "2026-01-01", endDate: "2026-06-30",
      layer: "reported", offenseCategory: "",
    });
    const wire = JSON.parse(
      decodeURIComponent(escape(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")))),
    );
    expect(wire.t).toBeUndefined();
    expect(wire.pts).toHaveLength(1);
  });

  it("decodes a hand-built wire object that omits the tab key (tab-free format)", () => {
    const wire = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "Home" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const view = decodeView(wire);
    expect(view).not.toBeNull();
    expect(view!.points[0].label).toBe("Home");
  });

  it("decodes a legacy tab=analyze link onto the unified view", () => {
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "analyze", r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "Home" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const view = decodeView(legacy);
    expect(view).not.toBeNull();
    expect(view!.points[0].label).toBe("Home");
  });

  it("decodes a legacy tab=compare link onto the unified view", () => {
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "compare", r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "A" }, { y: 47.61, x: -122.34, l: "B" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const view = decodeView(legacy);
    expect(view).not.toBeNull();
    expect(view!.points).toHaveLength(2);
  });

  it("still rejects wire garbage (unknown t value)", () => {
    const bad = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "bogus", r: 250, s: "2026-01-01", e: "2026-06-30", ly: "reported",
      pts: [{ y: 47.6, x: -122.33, l: "Home" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeView(bad)).toBeNull();
  });
});

describe("legacy routes links", () => {
  it("decodes a v1 routes-tab link to null instead of a view", () => {
    const wire = {
      v: 1,
      t: "routes",
      o: { y: 47.62, x: -122.33, l: "Home" },
      d: { y: 47.61, x: -122.34, l: "Office" },
      m: "transit",
      r: 500,
      s: "2024-01-01",
      e: "2024-01-31",
      ly: "calls",
    };
    const param = btoa(JSON.stringify(wire)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeView(param)).toBeNull();
  });
});
