import type { LayerKey } from "../types";

export type ViewTab = "analyze" | "compare";

export interface ViewPoint {
  latitude: number;
  longitude: number;
  label: string;
}

export interface SavedView {
  tab: ViewTab;
  points: ViewPoint[];
  radiusM: number;
  startDate: string;
  endDate: string;
  layer: LayerKey;
  offenseCategory: string;
}

const VERSION = 1;
const MAX_ENCODED_LENGTH = 2000;

function toBase64Url(json: string): string {
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const padded = param.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeView(view: SavedView): string {
  const wire = {
    v: VERSION,
    t: view.tab,
    pts: view.points.map((p) => ({ y: p.latitude, x: p.longitude, l: p.label })),
    r: view.radiusM,
    s: view.startDate,
    e: view.endDate,
    ly: view.layer,
    c: view.offenseCategory || null,
  };
  return toBase64Url(JSON.stringify(wire));
}

export function decodeView(param: string): SavedView | null {
  if (!param || param.length > MAX_ENCODED_LENGTH) return null;
  try {
    const wire = JSON.parse(fromBase64Url(param));
    if (wire.v !== VERSION) return null;
    if (wire.t !== "analyze" && wire.t !== "compare") return null;
    if (!Array.isArray(wire.pts) || wire.pts.length === 0) return null;
    const points = wire.pts.map((p: { y: number; x: number; l: string }) => ({
      latitude: p.y, longitude: p.x, label: String(p.l),
    }));
    if (points.some((p: ViewPoint) => typeof p.latitude !== "number" || typeof p.longitude !== "number")) {
      return null;
    }
    return {
      tab: wire.t,
      points,
      radiusM: Number(wire.r),
      startDate: String(wire.s),
      endDate: String(wire.e),
      layer: wire.ly === "calls" ? "calls" : "reported",
      offenseCategory: wire.c ?? "",
    };
  } catch {
    return null;
  }
}
