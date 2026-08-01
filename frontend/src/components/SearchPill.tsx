import { useEffect, useId, useRef, useState } from "react";

import { useAddressSearch } from "../lib/useAddressSearch";
import type { GeocodeResult } from "../types";

type Props = {
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onSelect: (result: GeocodeResult) => void;
  addPinMode: boolean;
  onToggleAddPin: () => void;
  canClearPins?: boolean;
  onClearPins?: () => void;
};

export function SearchPill({ search, onSelect, addPinMode, onToggleAddPin, canClearPins = false, onClearPins }: Props) {
  const { query, setQuery, results, status, rememberPlace } = useAddressSearch(search);
  const [open, setOpen] = useState(false);
  // -1 = nothing highlighted, so Enter falls through to the first suggestion.
  const [active, setActive] = useState(-1);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listOpen = open && results.length > 0;
  const optionId = (index: number) => `${listId}-opt-${index}`;

  function select(result: GeocodeResult) {
    rememberPlace(result);
    setQuery("");
    setOpen(false);
    setActive(-1);
    onSelect(result);
  }

  // A fresh result set invalidates whatever row was highlighted.
  useEffect(() => setActive(-1), [results]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "Enter") {
      if (!listOpen) return;
      event.preventDefault();
      select(results[active >= 0 ? active : 0]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((current) =>
        event.key === "ArrowDown"
          ? (current + 1) % results.length
          : (current <= 0 ? results.length : current) - 1,
      );
    }
  }

  return (
    <div className="mc-searchpill" ref={rootRef}>
      <div className="mc-searchpill-row">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
        <input
          id="mc-search-input"
          role="combobox"
          aria-label="Search address or place"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
          placeholder="Search address or drop a pin"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          // Focus moving into the list itself (clicking a suggestion) must not close it
          // before the click lands.
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
        />
        <button
          type="button"
          className={`mc-searchpill-pin${addPinMode ? " is-armed" : ""}`}
          aria-pressed={addPinMode}
          aria-label="Drop a pin on the map"
          onClick={onToggleAddPin}
        >
          <svg viewBox="0 0 24 32" width="13" height="16"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          className="mc-searchpill-clear"
          aria-label="Clear all pins"
          title="Clear all pins"
          disabled={!canClearPins}
          onClick={() => {
            setOpen(false);
            setActive(-1);
            onClearPins?.();
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>
      {listOpen ? (
        <ul className="mc-searchpill-results" id={listId} role="listbox">
          {results.map((result, index) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button
                type="button"
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={index === active ? "is-active" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(result)}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {status === "error" ? <p className="mc-searchpill-msg" role="status">Search is unavailable right now.</p> : null}
    </div>
  );
}
