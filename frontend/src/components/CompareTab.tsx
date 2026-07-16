import { useMemo } from "react";
import type { ReactNode } from "react";

import { toCompareVerdict } from "../lib/compareVerdict";
import { incidentNoun } from "../lib/layerCopy";
import type { GeocodingProvider } from "../lib/geocoding";
import type { ComparePoint } from "../lib/useCompareSet";
import { MAX_COMPARE_POINTS, keyOf } from "../lib/useCompareSet";
import type { AnalysisSettings, NeighborhoodAnalysis, SiteComparison } from "../types";
import { plotDomainMax } from "./BaselineIntervalPlot";
import { CompareAddressInput } from "./CompareAddressInput";
import { CompareRankedList } from "./CompareRankedList";
import { CompareRateNumberLine } from "./CompareRateNumberLine";
import { CompareVerdict } from "./CompareVerdict";
import { MethodsAppendix } from "./MethodsAppendix";
import { PlaceContextCard } from "./PlaceContextCard";

type Props = {
  set: ComparePoint[];
  provider: GeocodingProvider;
  onAddPoint: (point: ComparePoint) => void;
  onRemovePoint: (index: number) => void;
  /** Coord keys of the user's saved places, so already-saved points show "Saved" not "Save". */
  savedKeys: Set<string>;
  onSavePoint: (point: ComparePoint) => void;
  analysis: AnalysisSettings;
  comparison: SiteComparison | null;
  /** Per-address neighborhood context from the same run; null degrades expansions. */
  neighborhood: NeighborhoodAnalysis | null;
  running: boolean;
  onRun: () => void;
  onCopyLink?: () => string | null;
  /** Rendered above the panel head; the panel is absolutely positioned, so drawer-level
   * chrome (place chip strip, pin-draft popover) must live inside it to be visible. */
  topSlot?: ReactNode;
};

const REVISED_CAVEAT =
  "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ set, provider, onAddPoint, onRemovePoint, savedKeys, onSavePoint, analysis, comparison, neighborhood, running, onRun, onCopyLink, topSlot }: Props) {
  const noun = incidentNoun(analysis.layer);
  const canRun = set.length >= 2 && !running;
  const verdict = comparison ? toCompareVerdict(comparison) : null;

  const expansionByOptionId = useMemo(() => {
    if (!comparison || !neighborhood?.places?.length) return undefined;
    const domainMax = plotDomainMax(neighborhood.places);
    const windowLabel = `${neighborhood.analysis_start_date} – ${neighborhood.analysis_end_date}`;
    const map = new Map<string, ReactNode>();
    comparison.analytical.options.forEach((option, index) => {
      const place = neighborhood.places[index];
      if (!place) return;
      const point = set[index];
      map.set(
        option.id,
        <PlaceContextCard
          place={place}
          index={index}
          windowLabel={windowLabel}
          noun={noun}
          domainMax={domainMax}
          locator={null}
          coords={point ? { latitude: point.latitude, longitude: point.longitude } : null}
        />,
      );
    });
    return map;
  }, [comparison, neighborhood, set, noun]);

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Compare">
      {topSlot}
      <div className="mc-panel-head"><h4>Compare addresses</h4></div>

      <div className="mc-cmpset">
        <div className="mc-cmpset-head"><span className="mc-label">Addresses to compare · {set.length} of {MAX_COMPARE_POINTS}</span></div>
        <CompareAddressInput provider={provider} onAdd={onAddPoint} disabled={set.length >= MAX_COMPARE_POINTS} />
        {set.length === 0 ? (
          <p className="mc-empty-list">Add at least two addresses to compare {noun.singular} context.</p>
        ) : (
          <ul className="mc-cmpset-rows" aria-label="Addresses to compare">
            {set.map((point, index) => (
              <li key={`${point.latitude},${point.longitude}`} className="mc-cmpset-row">
                <span className="idx">{index + 1}</span>
                <span className="lbl">{point.label}</span>
                {savedKeys.has(keyOf(point)) ? (
                  <span className="saved">Saved</span>
                ) : (
                  <button type="button" className="save" onClick={() => onSavePoint(point)}>Save</button>
                )}
                <button type="button" className="rm" aria-label={`Remove ${point.label}`} onClick={() => onRemovePoint(index)}>✕</button>
              </li>
            ))}
          </ul>
        )}
        {set.length === 1 ? <p className="mc-search-msg">Add one more address to compare.</p> : null}
      </div>

      {onCopyLink && comparison && (
        <button type="button" className="mc-link-copy" onClick={async () => { const url = onCopyLink(); if (url) await navigator.clipboard.writeText(url); }}>
          Copy link to this view
        </button>
      )}

      {verdict ? (
        <>
          <CompareVerdict callout={verdict.callout} noun={noun} />
          <p className="mc-ranked-title">Ranked by {noun.singular} rate — lowest first</p>
          <CompareRankedList rows={verdict.rows} noun={noun} radiusM={analysis.radiusM} expansionByOptionId={expansionByOptionId} />
          {!expansionByOptionId ? (
            <p className="mc-search-msg">Per-address context unavailable for this run.</p>
          ) : null}
          <CompareRateNumberLine rows={verdict.rows} noun={noun} radiusM={analysis.radiusM} />
        </>
      ) : set.length >= 2 ? (
        <p className="mc-empty-list">Compare these {set.length} addresses to rank their {noun.singular} rates.</p>
      ) : null}

      <div className="mc-caveat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
        {REVISED_CAVEAT}
      </div>

      <MethodsAppendix />

      <div className="mc-compare-actions">
        <span className="note">{set.length} address{set.length === 1 ? "" : "es"} · {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Comparing…" : "Compare addresses"}</button>
      </div>
    </div>
  );
}
