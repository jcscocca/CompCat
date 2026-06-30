import type { GeocodeResult } from "../types";

export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
}

// Mirrors backend app/config.py geocoder_viewbox, which is the source of truth.
// Client-side defense-in-depth: even if the backend config drifts, non-Seattle results
// are filtered before they reach the UI.
export const SEATTLE_BBOX = {
  west: -122.55,
  north: 47.78,
  east: -122.10,
  south: 47.43,
} as const;

export function withinSeattleBbox(result: GeocodeResult): boolean {
  return (
    result.latitude >= SEATTLE_BBOX.south &&
    result.latitude <= SEATTLE_BBOX.north &&
    result.longitude >= SEATTLE_BBOX.west &&
    result.longitude <= SEATTLE_BBOX.east
  );
}

// The browser no longer calls a public geocoder directly. It calls the
// session-required backend proxy (GET /dashboard/geocode), which caches results
// and is polite to the upstream provider. Same-origin in production; the Vite
// dev server proxies /dashboard to the backend.
export function createBackendProvider(endpoint = "/dashboard/geocode"): GeocodingProvider {
  return {
    async search(query, signal) {
      const trimmed = query.trim();
      if (!trimmed) {
        return [];
      }
      const url = `${endpoint}?q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, {
        signal,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }
      const results = (await response.json()) as GeocodeResult[];
      return results.filter(withinSeattleBbox);
    },
  };
}

export const geocodingProvider = createBackendProvider();
