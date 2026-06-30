import type { GeocodeResult } from "../types";

const RECENT_KEY = "waypoint.search.recent";
const MAX_RECENT = 5;

function dedupeKey(r: GeocodeResult): string {
  return `${r.label}|${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
}

export function loadRecentPlaces(): GeocodeResult[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GeocodeResult[];
  } catch {
    // private mode or disabled storage degrades to empty list
    return [];
  }
}

export function addRecentPlace(result: GeocodeResult): GeocodeResult[] {
  const existing = loadRecentPlaces();
  const key = dedupeKey(result);
  const deduped = existing.filter((r) => dedupeKey(r) !== key);
  const next = [result, ...deduped].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore: quota exceeded or disabled storage degrades gracefully
  }
  return next;
}
