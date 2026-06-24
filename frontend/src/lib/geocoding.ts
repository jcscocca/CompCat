import type { GeocodeResult } from "../types";

export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
}

type NominatimRow = { display_name: string; lat: string; lon: string };

// Nominatim is fine for local/dev (max ~1 req/s, no autocomplete-style use).
// Public production must move to a provider that permits browser traffic at volume.
export function createNominatimProvider(
  endpoint = "https://nominatim.openstreetmap.org/search",
): GeocodingProvider {
  return {
    async search(query, signal) {
      const trimmed = query.trim();
      if (!trimmed) {
        return [];
      }
      const url = `${endpoint}?format=jsonv2&limit=5&q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }
      const rows = (await response.json()) as NominatimRow[];
      return rows.map((row) => ({
        label: row.display_name,
        latitude: Number(row.lat),
        longitude: Number(row.lon),
        source: "nominatim",
      }));
    },
  };
}

export const geocodingProvider = createNominatimProvider();
