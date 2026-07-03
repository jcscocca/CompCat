import { useEffect, useRef, useState } from "react";

import type { GeocodeResult } from "../types";
import { addRecentPlace, loadRecentPlaces } from "./searchHistory";

export type AddressSearchStatus = "idle" | "loading" | "done" | "empty" | "error";

export const DEBOUNCE_MS = 300;
export const SEARCH_EMPTY_MSG = "No matches. Drop a pin on the map instead.";
export const SEARCH_ERROR_MSG = "Search is unavailable. Drop a pin on the map instead.";

export interface AddressSearch {
  query: string;
  setQuery: (value: string) => void;
  status: AddressSearchStatus;
  results: GeocodeResult[];
  recent: GeocodeResult[];
  runSearch: () => Promise<void>;
  rememberPlace: (result: GeocodeResult) => void;
}

/**
 * Shared address-search state machine for the geocode box used by the Places map search
 * (PlaceSearch). Owns the query, the trimmed geocode call, and the loading/done/empty/error
 * status; callers render the input and the results however they need (a clickable list).
 *
 * Type-ahead: a useEffect on query debounces the search ~300 ms after the last keystroke,
 * aborting any in-flight stale request. runSearch() bypasses the debounce for immediate
 * triggers (Enter key / Search button).
 *
 * Recent places: loaded from localStorage on mount; updated via rememberPlace (call inside
 * the consumer's existing select handler so selection logic stays in the consumer).
 */
export function useAddressSearch(
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>,
): AddressSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<AddressSearchStatus>("idle");
  const [recent, setRecent] = useState<GeocodeResult[]>(() => loadRecentPlaces());

  // abortRef holds the in-flight request's controller and is shared by the debounce effect
  // and runSearch. When the query changes, the effect may abort an in-flight runSearch
  // request via this shared ref; that is benign and self-heals on the next debounce — the
  // newer query's result is the one we want, and the aborted older request is ignored.
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On unmount, abort whatever request is currently in flight. The per-query effect cleanup
  // only aborts the effect's own controller; this also covers a runSearch request still in
  // flight when the component unmounts (e.g. switching tabs), avoiding a post-unmount setState.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Single source of truth for the empty/done/error + abort-guard logic, shared by the
  // debounce effect and runSearch.
  function runFetch(trimmed: string, controller: AbortController): Promise<void> {
    setStatus("loading");
    return search(trimmed, controller.signal)
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
  }

  useEffect(() => {
    const trimmed = query.trim();

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
      void runFetch(trimmed, controller);
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
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    await runFetch(trimmed, controller);
  }

  function rememberPlace(result: GeocodeResult) {
    const next = addRecentPlace(result);
    setRecent(next);
  }

  return { query, setQuery, status, results, recent, runSearch, rememberPlace };
}
