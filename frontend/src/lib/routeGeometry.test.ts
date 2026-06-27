import { describe, expect, it } from "vitest";

import { parseRouteGeometry } from "./routeGeometry";

describe("parseRouteGeometry", () => {
  it("parses a lat,lon;lat,lon string into points", () => {
    expect(parseRouteGeometry("47.61,-122.33;47.60,-122.34")).toEqual([
      [47.61, -122.33],
      [47.6, -122.34],
    ]);
  });

  it("returns [] for empty or malformed input", () => {
    expect(parseRouteGeometry(null)).toEqual([]);
    expect(parseRouteGeometry("")).toEqual([]);
    expect(parseRouteGeometry("not-a-point")).toEqual([]);
  });
});
