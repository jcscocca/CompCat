import { keyOf, type AddressEntry } from "../lib/useAddressList";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { Place } from "../types";

type Props = {
  places: Place[];
  entries: AddressEntry[];
  identityByPlaceId: Map<string, PlaceIdentity>;
  savingKey?: string | null;
  saveHiddenKey?: string | null;
  onToggle: (id: string) => void;
  onFocus: (entry: AddressEntry) => void;
  onHoverPlace: (id: string | null) => void;
  onRemove: (index: number) => void;
  onSave: (entry: AddressEntry) => void;
  onAdd: () => void;
};

/** Saved-place selectors plus any ad-hoc/search/share points in the active analysis scope. */
export function PlaceChipStrip({ places, entries, identityByPlaceId, savingKey = null, saveHiddenKey = null, onToggle, onFocus, onHoverPlace, onRemove, onSave, onAdd }: Props) {
  const adHocEntries = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => !entry.savedPlaceId);
  return (
    <div className="mc-chipstrip mc-scope-locations" role="group" aria-label="Locations">
      {places.map((place) => {
        const identity = identityByPlaceId.get(place.id);
        const selected = identity !== undefined;
        return (
          <button
            key={place.id}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={place.display_label}
            className={`mc-chip${selected ? " on" : ""}`}
            onClick={() => onToggle(place.id)}
            onMouseEnter={() => onHoverPlace(place.id)}
            onMouseLeave={() => onHoverPlace(null)}
            onFocus={() => onHoverPlace(place.id)}
            onBlur={() => onHoverPlace(null)}
          >
            {identity ? <span className={`mc-idbadge id-${identity.slot}`} aria-hidden="true">{identity.letter}</span> : null}
            <span className="mc-chip-label">{place.display_label}</span>
          </button>
        );
      })}
      {adHocEntries.map(({ entry, index }) => {
        const id = keyOf(entry);
        const identity = identityByPlaceId.get(id);
        return (
          <span className="mc-scope-location" key={id}>
            <button
              type="button"
              className="mc-chip on mc-scope-location-focus"
              aria-label={`Show ${entry.label} on map`}
              onClick={() => onFocus(entry)}
              onMouseEnter={() => onHoverPlace(id)}
              onMouseLeave={() => onHoverPlace(null)}
              onFocus={() => onHoverPlace(id)}
              onBlur={() => onHoverPlace(null)}
            >
              {identity ? <span className={`mc-idbadge id-${identity.slot}`} aria-hidden="true">{identity.letter}</span> : null}
              <span className="mc-chip-label">{entry.label}</span>
              <span className="mc-scope-unsaved">Unsaved</span>
            </button>
            {saveHiddenKey !== id ? (
              <button
                type="button"
                className="mc-scope-location-action"
                disabled={savingKey === id}
                onClick={() => onSave(entry)}
              >
                {savingKey === id ? "Saving…" : "Save"}
              </button>
            ) : null}
            <button
              type="button"
              className="mc-scope-location-remove"
              aria-label={`Remove ${entry.label} from analysis`}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </span>
        );
      })}
      <button type="button" className="mc-chip mc-chip-add" aria-label="Add or manage places" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add location
      </button>
    </div>
  );
}
