import { type FormEvent } from "react";

import { useAddressSearch, SEARCH_EMPTY_MSG, SEARCH_ERROR_MSG } from "../lib/useAddressSearch";
import { compactGeocodeLabel } from "../lib/addressLabel";
import type { GeocodingProvider } from "../lib/geocoding";
import type { AddressEntry } from "../lib/useCompareSet";
import type { GeocodeResult } from "../types";

type Props = {
  provider: GeocodingProvider;
  onAdd: (point: AddressEntry) => void;
  disabled: boolean;
};

export function CompareAddressInput({ provider, onAdd, disabled }: Props) {
  const { query, setQuery, status, results, runSearch, rememberPlace } = useAddressSearch(provider.search);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled) void runSearch();
  }

  function handleSelect(result: GeocodeResult) {
    rememberPlace(result);
    onAdd({ latitude: result.latitude, longitude: result.longitude, label: compactGeocodeLabel(result.label) });
    setQuery("");
  }

  return (
    <div className="mc-search-wrap">
      <form className="mc-search mc-search--sheet" onSubmit={onSubmit} role="search">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={disabled ? "10 addresses max" : "Add an address to compare"}
          aria-label="Add an address to compare"
          disabled={disabled}
        />
        <button type="submit" className="mc-search-go" disabled={disabled}>Add</button>
      </form>
      {status === "error" ? <p className="mc-search-msg" role="alert">{SEARCH_ERROR_MSG}</p> : null}
      {status === "empty" ? <p className="mc-search-msg">{SEARCH_EMPTY_MSG}</p> : null}
      {!disabled && results.length > 0 ? (
        <ul className="mc-results" aria-label="Address results">
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
