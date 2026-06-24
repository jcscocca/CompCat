import type { AnalysisSettings, Place } from "../types";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  availableRadii: number[];
  running: boolean;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

export function AnalyzeTab({ selected, analysis, availableRadii, running, onChange, onRun }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const canRun = selected.length >= 1 && !running;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Analyze">
      <div className="mc-field">
        <label htmlFor="analysis-start-date">Date range</label>
        <div className="mc-inputs">
          <input id="analysis-start-date" type="date" className="mc-inp" value={analysis.startDate} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
          <input id="analysis-end-date" type="date" className="mc-inp" value={analysis.endDate} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
        </div>
      </div>

      <div className="mc-field">
        <label id="radius-label">Search radius</label>
        <div className="mc-chips" role="group" aria-labelledby="radius-label">
          {radii.map((value) => (
            <button key={value} type="button" className={`mc-chip${analysis.radiusM === value ? " on" : ""}`} aria-pressed={analysis.radiusM === value} onClick={() => onChange({ radiusM: value })}>
              {value} m
            </button>
          ))}
        </div>
      </div>

      <div className="mc-field">
        <label id="category-label">Incident categories</label>
        <div className="mc-chips" role="group" aria-labelledby="category-label">
          {CATEGORIES.map((category) => (
            <button key={category.value || "all"} type="button" className={`mc-chip${analysis.offenseCategory === category.value ? " on" : ""}`} aria-pressed={analysis.offenseCategory === category.value} onClick={() => onChange({ offenseCategory: category.value })}>
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: 60 }} />
      <div className="mc-footer">
        <span className="note">{selected.length} place{selected.length === 1 ? "" : "s"} - {analysis.radiusM} m</span>
        <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Running..." : "Run analysis"}</button>
      </div>
    </div>
  );
}
