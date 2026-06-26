import { incidentCountForPlace } from "../lib/incidentSummaries";
import type { AnalysisSettings, CrimeSummary, DashboardSummary, Place } from "../types";
import { MethodsAppendix } from "./MethodsAppendix";

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  summary: DashboardSummary | null;
  comparison: Record<string, unknown> | null;
  running: boolean;
  onRun: () => void;
};

const REVISED_CAVEAT =
  "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

type BreakdownRow = {
  key: string;
  label: string;
  countsByPlaceId: Map<string, number>;
  total: number;
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function incidentTypeLabel(summary: Pick<CrimeSummary, "offense_category" | "offense_subcategory" | "nibrs_group">) {
  const parts = [summary.offense_category, summary.offense_subcategory].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.map(titleCase).join(" / ");
  return summary.nibrs_group ? `NIBRS ${summary.nibrs_group}` : "All reported";
}

function summariesForPlace(summary: DashboardSummary | null, placeId: string, radiusM: number) {
  return (summary?.crime_summaries ?? []).filter(
    (entry) => entry.place_cluster_id === placeId && entry.radius_m === radiusM,
  );
}

function nearestIncidentText(entries: CrimeSummary[]) {
  const nearest = entries
    .map((entry) => entry.nearest_incident_m)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  return nearest === undefined ? "nearest unavailable" : `nearest ${Math.round(nearest)} m`;
}

function breakdownRows(summary: DashboardSummary | null, selected: Place[], radiusM: number): BreakdownRow[] {
  const selectedIds = new Set(selected.map((place) => place.id));
  const rows = new Map<string, BreakdownRow>();
  for (const entry of summary?.crime_summaries ?? []) {
    if (entry.radius_m !== radiusM || !selectedIds.has(entry.place_cluster_id)) continue;
    const key = `${entry.offense_category ?? ""}|${entry.offense_subcategory ?? ""}|${entry.nibrs_group ?? ""}`;
    const existing = rows.get(key) ?? {
      key,
      label: incidentTypeLabel(entry),
      countsByPlaceId: new Map<string, number>(),
      total: 0,
    };
    existing.countsByPlaceId.set(
      entry.place_cluster_id,
      (existing.countsByPlaceId.get(entry.place_cluster_id) ?? 0) + entry.incident_count,
    );
    existing.total += entry.incident_count;
    rows.set(key, existing);
  }
  return Array.from(rows.values()).sort((a, b) => b.total - a.total).slice(0, 5);
}

function rowInsight(row: BreakdownRow, selected: Place[]) {
  const ranked = selected
    .map((place) => ({ place, count: row.countsByPlaceId.get(place.id) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const highest = ranked[0];
  const lowest = ranked[ranked.length - 1];
  if (!highest || !lowest || highest.count === lowest.count) {
    return `Selected places have the same reported ${row.label} incident count.`;
  }
  const diff = highest.count - lowest.count;
  return `${highest.place.display_label} has ${diff} more reported ${row.label} incident${diff === 1 ? "" : "s"} than ${lowest.place.display_label}.`;
}

export function CompareTab({ selected, analysis, summary, comparison, running, onRun }: Props) {
  const overview = (comparison?.overview ?? null) as { summary_text?: string } | null;
  const canRun = selected.length >= 2 && !running;
  const rows = breakdownRows(summary, selected, analysis.radiusM);
  const showPersonGuidance = analysis.offenseCategory !== "" && analysis.offenseCategory !== "PERSON";

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
        {selected.map((place) => {
          const count = incidentCountForPlace(summary, place.id, analysis.radiusM);
          const entries = summariesForPlace(summary, place.id, analysis.radiusM);
          return (
            <div className="mc-cmpcard" key={place.id}>
              <div className="lbl">
                <svg width="13" height="17" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /></svg>
                {place.display_label}
              </div>
              <div className="big">{count ?? "N/A"}</div>
              <div className="cap">{count === null ? "not analyzed yet" : "reported incidents in range"}</div>
              {count !== null ? <div className="mc-cmpmeta">{nearestIncidentText(entries)}</div> : null}
            </div>
          );
        })}
      </div>

      {showPersonGuidance ? (
        <p className="mc-compare-summary">Run Analyze with All reported or Person to compare assault and other person-incident categories.</p>
      ) : null}

      {rows.length > 0 ? (
        <section className="mc-breakdown" aria-label="Incident type breakdown">
          <div className="mc-breakdown-head">
            <h5>Incident type breakdown</h5>
            <span>{analysis.radiusM} m</span>
          </div>
          {rows.map((row) => (
            <div className="mc-breakdown-row" key={row.key}>
              <div className="mc-breakdown-label">
                <strong>{row.label}</strong>
                <small>{rowInsight(row, selected)}</small>
              </div>
              <div className="mc-breakdown-counts">
                {selected.map((place) => (
                  <span key={place.id}>
                    <b>{row.countsByPlaceId.get(place.id) ?? 0}</b>
                    <small>{place.display_label}</small>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <p className="mc-empty-list">Run analysis for these places to see category and subcategory breakdowns.</p>
      )}

      {overview?.summary_text ? <p className="mc-compare-summary">{overview.summary_text}</p> : null}

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
