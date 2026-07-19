import { useState } from "react";

import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { incidentNoun } from "../lib/layerCopy";
import { CATEGORIES, categoryLabel } from "../lib/offenseCategories";
import type { AnalysisSettings } from "../types";

type Props = {
  analysis: AnalysisSettings;
  availableRadii: number[];
  onChange: (patch: Partial<AnalysisSettings>) => void;
};

/** One-line active-context summary above Tabby's input. This is literally the
 * dashboard_state Tabby sees each turn — tapping it opens inline editors. */
export function ContextStrip({ analysis, availableRadii, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];

  return (
    <div className="mc-ctx">
      <button
        type="button"
        className="mc-ctx-summary"
        aria-expanded={open}
        aria-label={`Analysis context: ${analysis.startDate} – ${analysis.endDate}, ${analysis.radiusM} m, ${categoryLabel(analysis.offenseCategory)}, ${incidentNoun(analysis.layer).pluralCap}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{analysis.startDate} – {analysis.endDate}</span>
        <span>· {analysis.radiusM} m</span>
        <span>· {categoryLabel(analysis.offenseCategory)}</span>
        <span>· {incidentNoun(analysis.layer).pluralCap}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      </button>

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
          <div className="mc-field">
            <label id="ctx-category-label">Incident categories</label>
            <div className="mc-chips" role="group" aria-labelledby="ctx-category-label">
              {CATEGORIES.map((category) => (
                <button key={category.value || "all"} type="button" className={`mc-chip${analysis.offenseCategory === category.value ? " on" : ""}`} aria-pressed={analysis.offenseCategory === category.value} onClick={() => onChange({ offenseCategory: category.value })}>
                  {category.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="mc-chip" onClick={() => setOpen(false)}>Done</button>
        </div>
      ) : null}
    </div>
  );
}
