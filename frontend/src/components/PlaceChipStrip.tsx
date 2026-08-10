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
  const activeLabels = [
    ...places.filter((place) => identityByPlaceId.has(place.id)).map((place) => place.display_label),
    ...adHocEntries.map(({ entry }) => entry.label),
  ];
  const activeSummary = activeLabels.length === 0
    ? "No places selected"
    : activeLabels.length === 1
      ? activeLabels[0]
      : `${activeLabels.length} places selected`;
  const activeDetail = activeLabels.length === 0
    ? "Add a place to begin"
    : activeLabels.length === 1
      ? "Selected for this analysis"
      : activeLabels.join(" · ");

  return (
    <div className="mc-chipstrip mc-scope-locations" role="group" aria-label="Places">
      <div className="mc-place-control-head">
        <span className="mc-place-summary">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <span>
            <strong>{activeSummary}</strong>
            <small>{activeDetail}</small>
          </span>
        </span>
        <button type="button" className="mc-place-manage" aria-label="Manage places" title="Add, rename, or remove places" onClick={onAdd}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
          Manage
        </button>
      </div>
      {places.length > 0 || adHocEntries.length > 0 ? (
        <div className="mc-place-choice-list">
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
                title={`${selected ? "Remove" : "Add"} ${place.display_label} ${selected ? "from" : "to"} this analysis`}
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
                  aria-label={`Show ${entry.label} on map — Unsaved`}
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
                    // While saving, the visible "Saving…" is the whole name; idle needs the
                    // place so several Save buttons are distinguishable.
                    aria-label={savingKey === id ? undefined : `Save ${entry.label}`}
                    onClick={() => onSave(entry)}
                  >
                    {savingKey === id ? "Saving…" : "Save"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mc-scope-location-remove"
                  aria-label={`Remove ${entry.label} from analysis`}
                  title={`Remove ${entry.label} from analysis`}
                  onClick={() => onRemove(index)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
