import { incidentCountForPlace } from "../lib/incidentSummaries";
import type { AnalysisSettings, DashboardSummary, Place } from "../types";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  summary: DashboardSummary | null;
  comparison: Record<string, unknown> | null;
  running: boolean;
  onRun: () => void;
};

const REVISED_CAVEAT =
  "The app still compares the selected places, but it does not identify one as statistically lower-incident. Reported incidents can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ selected, analysis, summary, comparison, running, onRun }: Props) {
  const overview = (comparison?.overview ?? null) as { summary_text?: string } | null;
  const canRun = selected.length >= 2 && !running;

  if (selected.length < 2) {
    return (
      <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
        <div className="mc-panel-head"><h4>Compare places</h4></div>
        <p className="mc-empty-list">Select at least two places to compare reported-incident context.</p>
      </div>
    );
  }

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
      <div className="mc-panel-head"><h4>Comparing {selected.length} places <b>{analysis.radiusM} m</b></h4></div>

      <div className="mc-compare">
        {selected.slice(0, 2).map((place) => {
          const count = incidentCountForPlace(summary, place.id, analysis.radiusM);
          return (
            <div className="mc-cmpcard" key={place.id}>
              <div className="lbl">
                <svg width="13" height="17" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /></svg>
                {place.display_label}
              </div>
              <div className="big">{count ?? "N/A"}</div>
              <div className="cap">{count === null ? "not analyzed yet" : "reported incidents in range"}</div>
            </div>
          );
        })}
      </div>

      {overview?.summary_text ? <p className="mc-compare-summary">{overview.summary_text}</p> : null}

      <div className="mc-caveat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        {REVISED_CAVEAT}
      </div>

      <div style={{ height: 56 }} />
      <div className="mc-footer">
        <span className="note">{selected.length} selected - {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing..." : "Compare places"}</button>
      </div>
    </div>
  );
}
