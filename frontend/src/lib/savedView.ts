import type { LayerKey } from "../types";
import { withinSeattleBbox } from "./geocoding";

export type ViewTab = "analyze" | "compare" | "routes";
export type RouteMode = "transit" | "walk" | "bike" | "drive";
const ROUTE_MODES: RouteMode[] = ["transit", "walk", "bike", "drive"];

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

export interface RoutesSavedView extends SharedViewFields {
  tab: "routes";
  origin: ViewPoint;
  destination: ViewPoint;
  mode: RouteMode;
}

export type SavedView = PointsSavedView | RoutesSavedView;

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
  const wire =
    view.tab === "routes"
      ? { ...base, o: wirePoint(view.origin), d: wirePoint(view.destination), m: view.mode }
      : { ...base, pts: view.points.map(wirePoint), c: view.offenseCategory || null };
  return toBase64Url(JSON.stringify(wire));
}

// Parse one wire point. `bbox` gates on the Seattle bounding box (used for routes endpoints;
// the analyze/compare points path keeps its inc-1 behavior of not bbox-checking on decode).
function readWirePoint(raw: unknown, bbox: boolean): ViewPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const { y, x, l } = raw as { y: unknown; x: unknown; l: unknown };
  if (typeof y !== "number" || typeof x !== "number") return null;
  if (typeof l !== "string" || l.length === 0) return null;
  if (bbox && !withinSeattleBbox({ latitude: y, longitude: x, label: l, source: "" })) return null;
  return { latitude: y, longitude: x, label: l };
}

function decodeRoutesView(wire: {
  o?: unknown; d?: unknown; m?: unknown; r?: unknown; s?: unknown; e?: unknown; ly?: unknown;
}): RoutesSavedView | null {
  const origin = readWirePoint(wire.o, true);
  const destination = readWirePoint(wire.d, true);
  if (!origin || !destination) return null;
  if (typeof wire.m !== "string" || !ROUTE_MODES.includes(wire.m as RouteMode)) return null;
  return {
    tab: "routes",
    origin,
    destination,
    mode: wire.m as RouteMode,
    radiusM: Number(wire.r),
    startDate: String(wire.s),
    endDate: String(wire.e),
    layer: wire.ly === "calls" ? "calls" : "reported",
  };
}

export function decodeView(param: string): SavedView | null {
  if (!param || param.length > MAX_ENCODED_LENGTH) return null;
  try {
    const wire = JSON.parse(fromBase64Url(param));
    if (wire.v !== VERSION) return null;
    if (wire.t === "routes") return decodeRoutesView(wire);
    if (wire.t !== "analyze" && wire.t !== "compare") return null;
    if (!Array.isArray(wire.pts) || wire.pts.length === 0) return null;
    const points = wire.pts.map((p: unknown) => readWirePoint(p, false));
    if (points.some((p: ViewPoint | null) => p === null)) return null;
    return {
      tab: wire.t,
      points: points as ViewPoint[],
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
