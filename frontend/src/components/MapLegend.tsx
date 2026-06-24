export function MapLegend() {
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
          <svg width="16" height="20" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
        </span>
        <span>Selected</span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--clay-soft)", border: "1.5px solid rgba(205,106,69,.5)", display: "block" }} />
        </span>
        <span>Analyzed radius<small>incident count</small></span>
      </div>
      <div className="mc-leg-row">
        <span className="g">
          <svg width="15" height="19" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#74858E" /><text x="12" y="16" fontSize="13" fill="#fff" textAnchor="middle" fontFamily="Archivo">?</text></svg>
        </span>
        <span>Low data<small>needs review</small></span>
      </div>
    </div>
  );
}
