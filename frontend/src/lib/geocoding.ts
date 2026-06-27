import type { GeocodeResult } from "../types";

export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
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
      return (await response.json()) as GeocodeResult[];
    },
  };
}

export const geocodingProvider = createBackendProvider();
