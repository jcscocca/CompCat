import { toCompareVerdict } from "../lib/compareVerdict";
import { incidentNoun } from "../lib/layerCopy";
import type { AnalysisSettings, Place, SiteComparison } from "../types";
import { CompareRankedList } from "./CompareRankedList";
import { CompareVerdict } from "./CompareVerdict";
import { MethodsAppendix } from "./MethodsAppendix";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  comparison: SiteComparison | null;
  running: boolean;
  onRun: () => void;
  onCopyLink?: () => string | null;
};

const REVISED_CAVEAT =
  "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ selected, analysis, comparison, running, onRun, onCopyLink }: Props) {
  const noun = incidentNoun(analysis.layer);
  const canRun = selected.length >= 2 && !running;

  if (selected.length < 2) {
    return (
      <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
        <div className="mc-panel-head"><h4>Compare places</h4></div>
        <p className="mc-empty-list">Select at least two places to compare {noun.singular} context.</p>
      </div>
    );
  }

  const verdict = comparison ? toCompareVerdict(comparison) : null;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
      <div className="mc-panel-head"><h4>Comparing {selected.length} places <b>{analysis.radiusM} m</b></h4></div>

      {onCopyLink && comparison && (
        <button
          type="button"
          className="mc-link-copy"
          onClick={async () => {
            const url = onCopyLink();
            if (url) await navigator.clipboard.writeText(url);
          }}
        >
          Copy link to this view
        </button>
      )}

      {verdict ? (
        <>
          <CompareVerdict callout={verdict.callout} noun={noun} />
          <p className="mc-ranked-title">Ranked by {noun.singular} rate — lowest first</p>
          <CompareRankedList rows={verdict.rows} noun={noun} />
        </>
      ) : (
        <p className="mc-empty-list">Compare these {selected.length} places to rank their {noun.singular} rates.</p>
      )}

      <div className="mc-caveat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        {REVISED_CAVEAT}
      </div>

      <MethodsAppendix />

      <div className="mc-compare-actions">
        <span className="note">{selected.length} selected · {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing…" : "Compare places"}</button>
      </div>
    </div>
  );
}
