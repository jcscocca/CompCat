// Chip-scale geometry for the MCPP locator mini-map: equirectangular projection with a
// cos-latitude x-scale (adequate at city scale), ring downsampling for 64px rendering,
// and SVG path strings. Pure functions; callers compute the mosaic once per fetch.
import type { McppFeatureCollection } from "../types";

export const CHIP_W = 64;
export const CHIP_H = 72;

export type LocatorBox = { west: number; south: number; east: number; north: number; cosLat: number };

type Ring = [number, number][];

function rings(geometry: { type: string; coordinates: unknown }): Ring[] {
  if (geometry.type === "Polygon") return geometry.coordinates as Ring[];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as Ring[][]).flat();
  return [];
}

export function collectionBox(fc: McppFeatureCollection): LocatorBox | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const feature of fc.features) {
    for (const ring of rings(feature.geometry)) {
      for (const [x, y] of ring) {
        if (x < west) west = x;
        if (x > east) east = x;
        if (y < south) south = y;
        if (y > north) north = y;
      }
    }
  }
  if (!Number.isFinite(west) || east === west || north === south) return null;
  const cosLat = Math.cos(((south + north) / 2) * (Math.PI / 180));
  return { west, south, east, north, cosLat };
}

export function project(lon: number, lat: number, box: LocatorBox): [number, number] {
  const spanX = (box.east - box.west) * box.cosLat;
  const spanY = box.north - box.south;
  const scale = Math.min(CHIP_W / spanX, CHIP_H / spanY);
  const offsetX = (CHIP_W - spanX * scale) / 2;
  const offsetY = (CHIP_H - spanY * scale) / 2;
  return [offsetX + (lon - box.west) * box.cosLat * scale, offsetY + (box.north - lat) * scale];
}

export function downsample(ring: Ring, keepEvery = 3): Ring {
  if (ring.length <= 8) return ring;
  const out = ring.filter((_, i) => i % keepEvery === 0);
  const last = ring[ring.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function ringPath(ring: Ring, box: LocatorBox): string {
  const points = downsample(ring)
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat, box);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("");
  return `${points}Z`;
}

export function featurePath(fc: McppFeatureCollection, name: string, box: LocatorBox): string {
  const feature = fc.features.find((f) => f.properties.mcpp === name);
  if (!feature) return "";
  return rings(feature.geometry).map((ring) => ringPath(ring, box)).join("");
}

export function mosaicPath(fc: McppFeatureCollection, box: LocatorBox): string {
  return fc.features.map((f) => rings(f.geometry).map((ring) => ringPath(ring, box)).join("")).join("");
}
