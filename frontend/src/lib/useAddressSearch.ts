import { useState } from "react";

import type { GeocodeResult } from "../types";

export type AddressSearchStatus = "idle" | "loading" | "done" | "error";

export interface AddressSearch {
  query: string;
  setQuery: (value: string) => void;
  status: AddressSearchStatus;
  results: GeocodeResult[];
  runSearch: () => Promise<void>;
}

/**
 * Shared address-search state machine for the geocode box used by both the Places map
 * search (PlaceSearch) and the Routes endpoint search (RoutesTab). Owns the query, the
 * trimmed geocode call, and the loading/done/error status; callers render the input and
 * the results however they need (a clickable list for Places, endpoint options for Routes).
 */
export function useAddressSearch(
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
): AddressSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>("idle");

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setStatus("loading");
    try {
      const found = await search(trimmed);
      setResults(found);
      setStatus("done");
    } catch {
      setResults([]);
      setStatus("error");
    }
  }

  return { query, setQuery, status, results, runSearch };
}
