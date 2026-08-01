import { incidentNoun } from "../lib/layerCopy";
import type { LayerKey } from "../types";

type Props = {
  /** The active data layer, so the dot/cluster rows name what is actually plotted. */
  layer: LayerKey;
  /** Target of the mobile "Map key" toggle's aria-controls. */
  id?: string;
  /** Set on mobile, where the legend is an overlay the toggle opens; never on desktop. */
  hidden?: boolean;
};

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MapLegend({ layer, id, hidden }: Props) {
  const noun = incidentNoun(layer);
  const headingId = id ? `${id}-heading` : "mc-map-legend-heading";
  return (
    <section className="mc-legend" id={id} hidden={hidden} aria-labelledby={headingId}>
      <h2 id={headingId}>Map key</h2>
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
          <svg width="15" height="19" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="var(--id-x)" /><text x="12" y="16" fontSize="13" fill="#fff" textAnchor="middle" fontFamily="Archivo">?</text></svg>
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
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#3A3F46", border: "1px solid #fff", display: "block", opacity: 0.6 }} />
        </span>
        <span>Grouped {noun.plural}<small>larger dot = more records · select for exact count</small></span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#3A3F46", border: "1px solid #fff", display: "block" }} />
        </span>
        <span>Same-block {noun.plural}<small>select for exact count · large stacks label at close zoom</small></span>
      </div>
    </section>
  );
}
