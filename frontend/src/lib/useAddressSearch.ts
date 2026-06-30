import { useEffect, useRef, useState } from "react";

import type { GeocodeResult } from "../types";

export type AddressSearchStatus = "idle" | "loading" | "done" | "empty" | "error";

export const DEBOUNCE_MS = 300;
export const SEARCH_EMPTY_MSG = "No matches. Drop a pin on the map instead.";
export const SEARCH_ERROR_MSG = "Search is unavailable. Drop a pin on the map instead.";

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
 * trimmed geocode call, and the loading/done/empty/error status; callers render the input and
 * the results however they need (a clickable list for Places, endpoint options for Routes).
 *
 * Type-ahead: a useEffect on query debounces the search ~300 ms after the last keystroke,
 * aborting any in-flight stale request. runSearch() bypasses the debounce for immediate
 * triggers (Enter key / Search button).
 */
export function useAddressSearch(
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
): AddressSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>("idle");

  // Holds the AbortController for the in-flight debounced request.
  const abortRef = useRef<AbortController | null>(null);
  // Holds the debounce timer id.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    // Clear any pending debounce and abort the current in-flight request.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (!trimmed) {
      setResults([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStatus("loading");
      search(trimmed, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setStatus(found.length === 0 ? "empty" : "done");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      controller.abort();
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    // Cancel the pending debounce so we don't double-fire.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    try {
      const found = await search(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      setStatus(found.length === 0 ? "empty" : "done");
    } catch {
      if (controller.signal.aborted) return;
      setResults([]);
      setStatus("error");
    }
  }

  return { query, setQuery, status, results, runSearch };
}
