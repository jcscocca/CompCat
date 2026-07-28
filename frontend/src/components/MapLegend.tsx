import { incidentNoun } from "../lib/layerCopy";
import type { LayerKey } from "../types";

type Props = {
  /** The active data layer, so the dot/cluster rows name what is actually plotted. */
  layer: LayerKey;
};

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MapLegend({ layer }: Props) {
  const noun = incidentNoun(layer);
  return (
    <div className="mc-legend" aria-label="Map key">
      <h3>Map key</h3>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="15" height="19" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#3A3F46" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
        </span>
        <span>Saved place</span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="16" height="20" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="var(--accent)" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
        </span>
        <span>Selected</span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--accent-soft)", border: "1.5px solid var(--accent)", display: "block" }} />
        </span>
        <span>Analyzed radius<small>{noun.singular} count</small></span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="15" height="19" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#74858E" /><text x="12" y="16" fontSize="13" fill="#fff" textAnchor="middle" fontFamily="Archivo">?</text></svg>
        </span>
        <span>Low data<small>needs review</small></span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3F46", border: "1px solid #fff", display: "block" }} />
        </span>
        <span>{sentenceCase(noun.singular)}</span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#3A3F46", border: "1.5px solid #fff", display: "grid", placeItems: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>5</span>
        </span>
        <span>{sentenceCase(noun.singular)} cluster<small>count</small></span>
      </div>
    </div>
  );
}
