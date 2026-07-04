import { PlaceSearch } from "./PlaceSearch";
import type { GeocodingProvider } from "../lib/geocoding";
import type { GeocodeResult } from "../types";

type Props = {
  provider: GeocodingProvider;
  onSelect: (result: GeocodeResult) => void;
  onManual: () => void;
};

/**
 * Fresh-session landing for the side drawer. Leads with a single-address lookup (the
 * reused PlaceSearch box, which already carries recent searches) so the first action is
 * "which place?", and offers a secondary escape into manual place management.
 */
export function AddressLookup({ provider, onSelect, onManual }: Props) {
  return (
    <div className="mc-panel is-active mc-lookup" role="tabpanel" aria-label="Look up an address">
      <div className="mc-lookup-head">
        <h4>Look up an address</h4>
        <p>See the reported-incident context around a place — then compare it with others if you like.</p>
      </div>
      <PlaceSearch provider={provider} onSelectResult={onSelect} />
      <button type="button" className="mc-link-copy mc-lookup-manual" onClick={onManual}>
        Add places manually
      </button>
    </div>
  );
}
