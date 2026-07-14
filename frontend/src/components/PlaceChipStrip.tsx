import type { PlaceIdentity } from "../lib/placeIdentity";
import type { Place } from "../types";

type Props = {
  places: Place[];
  identityByPlaceId: Map<string, PlaceIdentity>;
  onToggle: (id: string) => void;
  onHoverPlace: (id: string | null) => void;
  onAdd: () => void;
};

export function PlaceChipStrip({ places, identityByPlaceId, onToggle, onHoverPlace, onAdd }: Props) {
  return (
    <div className="mc-chipstrip" role="group" aria-label="Saved places">
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
            {selected ? (
              <span className={`mc-idbadge id-${identity.slot}`} aria-hidden="true">{identity.letter}</span>
            ) : null}
            <span className="mc-chip-label">{place.display_label}</span>
          </button>
        );
      })}
      <button type="button" className="mc-chip mc-chip-add" aria-label="Add or manage places" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add
      </button>
    </div>
  );
}
