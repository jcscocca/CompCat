import { describe, expect, it } from "vitest";

import type { McppFeatureCollection } from "../types";
import {
  CHIP_H,
  CHIP_W,
  collectionBox,
  downsample,
  featurePath,
  mosaicPath,
  project,
} from "./locatorGeometry";

const square = (x0: number, y0: number): [number, number][] => [
  [x0, y0], [x0 + 0.1, y0], [x0 + 0.1, y0 + 0.1], [x0, y0 + 0.1], [x0, y0],
];

const FC: McppFeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { mcpp: "ALPHA" }, geometry: { type: "Polygon", coordinates: [square(-122.4, 47.5)] } },
    {
      type: "Feature",
      properties: { mcpp: "BETA/GAMMA" },
      geometry: { type: "MultiPolygon", coordinates: [[square(-122.3, 47.7)], [square(-122.25, 47.72)]] },
    },
  ],
};

describe("locatorGeometry", () => {
  it("computes the collection bounding box", () => {
    const box = collectionBox(FC)!;
    expect(box.west).toBeCloseTo(-122.4);
    expect(box.east).toBeCloseTo(-122.15);
    expect(box.south).toBeCloseTo(47.5);
    expect(box.north).toBeCloseTo(47.82);
  });

  it("returns null for an empty collection", () => {
    expect(collectionBox({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("projects every vertex inside the chip viewBox", () => {
    const box = collectionBox(FC)!;
    for (const [lon, lat] of [[-122.4, 47.5], [-122.15, 47.82], [-122.3, 47.7]] as const) {
      const [x, y] = project(lon, lat, box);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CHIP_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CHIP_H);
    }
  });

  it("projects north to smaller y (SVG orientation)", () => {
    const box = collectionBox(FC)!;
    const [, yNorth] = project(-122.3, 47.82, box);
    const [, ySouth] = project(-122.3, 47.5, box);
    expect(yNorth).toBeLessThan(ySouth);
  });

  it("downsample keeps endpoints and leaves short rings alone", () => {
    const shortRing = square(0, 0);
    expect(downsample(shortRing)).toEqual(shortRing);
    const long: [number, number][] = Array.from({ length: 30 }, (_, i) => [i, i]);
    const sampled = downsample(long);
    expect(sampled.length).toBeLessThan(long.length);
    expect(sampled[0]).toEqual(long[0]);
    expect(sampled[sampled.length - 1]).toEqual(long[long.length - 1]);
  });

  it("featurePath finds a MultiPolygon feature by name and returns closed subpaths", () => {
    const box = collectionBox(FC)!;
    const path = featurePath(FC, "BETA/GAMMA", box);
    expect(path).toContain("M");
    expect((path.match(/Z/g) ?? []).length).toBe(2);
    expect(featurePath(FC, "NOWHERE", box)).toBe("");
  });

  it("mosaicPath covers every feature", () => {
    const box = collectionBox(FC)!;
    expect((mosaicPath(FC, box).match(/Z/g) ?? []).length).toBe(3);
  });
});
