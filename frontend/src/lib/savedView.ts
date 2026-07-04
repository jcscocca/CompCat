import type { LayerKey } from "../types";

export type ViewTab = "analyze" | "compare";

export interface ViewPoint {
  latitude: number;
  longitude: number;
  label: string;
}

interface SharedViewFields {
  radiusM: number;
  startDate: string;
  endDate: string;
  layer: LayerKey;
}

export interface PointsSavedView extends SharedViewFields {
  tab: "analyze" | "compare";
  points: ViewPoint[];
  offenseCategory: string;
}

export type SavedView = PointsSavedView;

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

const wirePoint = (p: ViewPoint) => ({ y: p.latitude, x: p.longitude, l: p.label });

export function encodeView(view: SavedView): string {
  const base = { v: VERSION, t: view.tab, r: view.radiusM, s: view.startDate, e: view.endDate, ly: view.layer };
  const wire = { ...base, pts: view.points.map(wirePoint), c: view.offenseCategory || null };
  return toBase64Url(JSON.stringify(wire));
}

function readWirePoint(raw: unknown): ViewPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const { y, x, l } = raw as { y: unknown; x: unknown; l: unknown };
  if (typeof y !== "number" || typeof x !== "number") return null;
  if (typeof l !== "string" || l.length === 0) return null;
  return { latitude: y, longitude: x, label: l };
}

export function decodeView(param: string): SavedView | null {
  if (!param || param.length > MAX_ENCODED_LENGTH) return null;
  try {
    const wire = JSON.parse(fromBase64Url(param));
    if (wire.v !== VERSION) return null;
    if (wire.t !== "analyze" && wire.t !== "compare") return null;
    if (!Array.isArray(wire.pts) || wire.pts.length === 0) return null;
    const points = wire.pts.map((p: unknown) => readWirePoint(p));
    if (points.some((p: ViewPoint | null) => p === null)) return null;
    const radiusM = Number(wire.r);
    if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 5000) return null;
    return {
      tab: wire.t,
      points: points as ViewPoint[],
      radiusM,
      startDate: String(wire.s),
      endDate: String(wire.e),
      layer: wire.ly === "calls" ? "calls" : wire.ly === "arrests" ? "arrests" : "reported",
      offenseCategory: wire.c ?? "",
    };
  } catch {
    return null;
  }
}
