import type { GeocodeResult } from "../types";
import { withinSeattleBbox } from "./geocoding";

const RECENT_KEY = "compcat.search.recent";
const MAX_RECENT = 5;

function dedupeKey(r: GeocodeResult): string {
  return `${r.label}|${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
}

function isStoredGeocodeResult(value: unknown): value is GeocodeResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GeocodeResult>;
  return typeof candidate.label === "string"
    && candidate.label.trim().length > 0
    && candidate.label.length <= 120
    && typeof candidate.source === "string"
    && candidate.source.length > 0
    && candidate.source.length <= 80
    && typeof candidate.latitude === "number"
    && Number.isFinite(candidate.latitude)
    && typeof candidate.longitude === "number"
    && Number.isFinite(candidate.longitude)
    && withinSeattleBbox(candidate as GeocodeResult);
}

function purgeLegacyRecentPlaces(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // Ignore blocked storage. The current tab-scoped store still works independently.
  }
}

export function loadRecentPlaces(): GeocodeResult[] {
  // Versions before the public privacy cleanup persisted exact address selections across
  // browser sessions. Never migrate that data forward: remove it as soon as this module is
  // used, then read only the tab-scoped store.
  purgeLegacyRecentPlaces();
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Validate every element rather than trusting a historical/tampered schema: rendering and
    // dedupe both dereference these fields. Filtering keeps one bad row from hiding good ones.
    return Array.isArray(parsed) ? parsed.filter(isStoredGeocodeResult).slice(0, MAX_RECENT) : [];
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
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore: quota exceeded or disabled storage degrades gracefully
  }
  return next;
}

export function clearRecentPlaces(): void {
  // Keep the removals independent so a blocked storage implementation cannot prevent the
  // other store from being cleared.
  try {
    sessionStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore: disabled storage is already effectively empty
  }
  purgeLegacyRecentPlaces();
}
