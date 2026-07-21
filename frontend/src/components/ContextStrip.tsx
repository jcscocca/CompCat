import { useEffect, useRef, useState, type ReactNode } from "react";

import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { incidentNoun, layerDisclosure } from "../lib/layerCopy";
import { CATEGORIES, categoryLabel } from "../lib/offenseCategories";
import type { AnalysisSettings } from "../types";

type Props = {
  analysis: AnalysisSettings;
  availableRadii: number[];
  onChange: (patch: Partial<AnalysisSettings>) => void;
  /** Runs the deterministic analyze/compare command for the current locations. */
  onRun?: () => void;
  runDisabled?: boolean;
  /** Saved-location selection belongs to the analysis context, so it is composed into
   * this single control instead of living in a second toolbar at the top of the rail. */
  locationControls?: ReactNode;
  /** Copies the share link and reports success/failure (the caller owns the URL + the
   * clipboard write); the strip only owns the transient status note. */
  onCopyLink?: () => Promise<boolean> | boolean;
};

/** One-line active-context summary above Tabby's input. This is literally the
 * dashboard_state Tabby sees each turn — tapping it opens inline editors. */
export function ContextStrip({ analysis, availableRadii, onChange, onRun, runDisabled, locationControls, onCopyLink }: Props) {
  const [open, setOpen] = useState(false);
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const disclosure = layerDisclosure(analysis.layer);
  const showCategories = analysis.layer !== "calls";
  const activeCategoryLabel = categoryLabel(analysis.offenseCategory, analysis.layer);
  const contextLabel = [
    `${analysis.startDate} – ${analysis.endDate}`,
    `${analysis.radiusM} m`,
    ...(showCategories ? [activeCategoryLabel] : []),
    incidentNoun(analysis.layer).pluralCap,
  ].join(", ");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);
  useEffect(() => () => { if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current); }, []);

  async function handleCopyLink() {
    if (!onCopyLink) return;
    const ok = await onCopyLink();
    setCopyState(ok ? "copied" : "failed");
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className="mc-ctx">
      <div className={`mc-ctx-summary${open ? " is-open" : ""}`}>
        <span className="mc-ctx-summary-head">
          <span className="mc-ctx-summary-label">
            <svg className="mc-ctx-filter-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Analysis filters
          </span>
          <button
            type="button"
            className="mc-ctx-summary-action"
            aria-expanded={open}
            aria-label={`Analysis context filters: ${contextLabel}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Close" : "Edit"}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
            </svg>
          </button>
        </span>
        {locationControls ? (
          <span className="mc-ctx-locations">
            <span className="mc-ctx-locations-label">Locations</span>
            {locationControls}
          </span>
        ) : null}
        {!open ? (
          <span className="mc-ctx-summary-values">
            <span className="mc-ctx-value">{analysis.startDate} – {analysis.endDate}</span>
            <span className="mc-ctx-value">{analysis.radiusM} m</span>
            {showCategories ? <span className="mc-ctx-value">{activeCategoryLabel}</span> : null}
            <span className="mc-ctx-value">{incidentNoun(analysis.layer).pluralCap}</span>
          </span>
        ) : null}
      </div>

      {disclosure ? <p className="mc-layer-note" role="note">{disclosure}</p> : null}

      {open ? (
        <div className="mc-ctx-editor">
          <div className="mc-field">
            <label htmlFor="ctx-start-date">Date range</label>
            <div className="mc-inputs">
              <input id="ctx-start-date" type="date" className="mc-inp" value={analysis.startDate} min={ANALYSIS_MIN_DATE} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
              <input id="ctx-end-date" type="date" className="mc-inp" value={analysis.endDate} min={ANALYSIS_MIN_DATE} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
            </div>
          </div>
          <div className="mc-field">
            <label id="ctx-radius-label">Search radius</label>
            <div className="mc-chips" role="group" aria-labelledby="ctx-radius-label">
              {radii.map((value) => (
                <button key={value} type="button" className={`mc-chip${analysis.radiusM === value ? " on" : ""}`} aria-pressed={analysis.radiusM === value} onClick={() => onChange({ radiusM: value })}>
                  {value} m
                </button>
              ))}
            </div>
          </div>
          {showCategories ? (
            <div className="mc-field">
              <label id="ctx-category-label">{analysis.layer === "arrests" ? "Arrest categories" : "Incident categories"}</label>
              <div className="mc-chips" role="group" aria-labelledby="ctx-category-label">
                {CATEGORIES.map((category) => (
                  <button key={category.value || "all"} type="button" className={`mc-chip${analysis.offenseCategory === category.value ? " on" : ""}`} aria-pressed={analysis.offenseCategory === category.value} onClick={() => onChange({ offenseCategory: category.value })}>
                    {category.value ? category.label : activeCategoryLabel}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mc-ctx-actions">
            <button type="button" className="mc-cta" disabled={runDisabled} onClick={() => onRun?.()}>Run analysis</button>
            <button type="button" className="mc-link-copy" onClick={() => void handleCopyLink()}>Copy link</button>
            <button type="button" className="mc-chip" onClick={() => setOpen(false)}>Done</button>
          </div>
          <span className="mc-copy-status" data-testid="copy-status" role="status" aria-live="polite">
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy — try again." : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
