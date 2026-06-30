import { type FormEvent, useState } from "react";

import { useAddressSearch, SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG } from "../lib/useAddressSearch";
import type { GeocodingProvider } from "../lib/geocoding";
import type { GeocodeResult } from "../types";

type Props = {
  provider: GeocodingProvider;
  onSelectResult: (result: GeocodeResult) => void;
};

export function PlaceSearch({ provider, onSelectResult }: Props) {
  const { query, setQuery, status, results, recent, runSearch, rememberPlace } = useAddressSearch(provider.search);
  const [focused, setFocused] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function handleSelect(result: GeocodeResult) {
    rememberPlace(result);
    onSelectResult(result);
  }

  const showRecent = focused && query.trim() === "" && recent.length > 0;

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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search an address or place"
          aria-label="Search an address or place"
        />
        <button type="submit" className="mc-search-go">Search</button>
      </form>
      {status === "error" ? (
        <p className="mc-search-msg" role="alert">{SEARCH_ERROR_MSG}</p>
      ) : null}
      {status === "empty" ? (
        <p className="mc-search-msg">{SEARCH_EMPTY_MSG}</p>
      ) : null}
      {showRecent ? (
        <ul className="mc-results mc-recent" aria-label="Recent searches">
          {recent.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button type="button" onMouseDown={() => handleSelect(r)}>
                <span className="mc-result-label">{r.label}</span>
                <span className="mc-result-coord">{r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {results.length > 0 ? (
        <ul className="mc-results" aria-label="Search results">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button type="button" onClick={() => handleSelect(result)}>
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
