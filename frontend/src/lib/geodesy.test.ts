import { describe, expect, it } from "vitest";
import { circlePolygonCoords } from "./geodesy";

// Haversine, for verifying ring points sit at the requested radius.
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

describe("circlePolygonCoords", () => {
  it("returns a closed ring of steps+1 [lng,lat] pairs", () => {
    const ring = circlePolygonCoords(47.6062, -122.3321, 250, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
  });

  it("places every vertex within 1% of the requested radius at Seattle latitude", () => {
    const ring = circlePolygonCoords(47.6062, -122.3321, 500, 64);
    for (const [lng, lat] of ring) {
      const d = haversineM(47.6062, -122.3321, lat, lng);
      expect(Math.abs(d - 500)).toBeLessThan(5);
    }
  });
});
