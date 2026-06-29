import type { FormEvent } from "react";

import { useAddressSearch } from "../lib/useAddressSearch";
import type { GeocodingProvider } from "../lib/geocoding";
import type { GeocodeResult } from "../types";

type Props = {
  provider: GeocodingProvider;
  onSelectResult: (result: GeocodeResult) => void;
};

export function PlaceSearch({ provider, onSelectResult }: Props) {
  const { query, setQuery, status, results, runSearch } = useAddressSearch(provider.search);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <div className="mc-search-wrap">
      <form className="mc-search mc-search--sheet" onSubmit={onSubmit} role="search">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search an address or place"
          aria-label="Search an address or place"
        />
        <button type="submit" className="mc-search-go">Search</button>
      </form>
      {status === "error" ? (
        <p className="mc-search-msg" role="alert">Search is unavailable. Drop a pin on the map instead.</p>
      ) : null}
      {status === "done" && results.length === 0 ? (
        <p className="mc-search-msg">No matches. Drop a pin on the map instead.</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mc-results" aria-label="Search results">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button type="button" onClick={() => onSelectResult(result)}>
                <span className="mc-result-label">{result.label}</span>
                <span className="mc-result-coord">{result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
