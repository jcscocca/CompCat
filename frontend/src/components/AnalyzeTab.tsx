import type { AnalysisSettings, CrimeSummary, DashboardSummary, IncidentDetail, IncidentDetailsResponse, Place } from "../types";

const INCIDENT_TABLE_MIN = 560;
const CHARTS_TWO_UP_MIN = 460;

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  summary: DashboardSummary | null;
  availableRadii: number[];
  running: boolean;
  incidentDetails?: IncidentDetailsResponse | null;
  error?: string;
  /**
   * Current expanded drawer width in pixels, used to choose the incident
   * layout (cards below {@link INCIDENT_TABLE_MIN}, table at/above) and the
   * chart column count. When omitted it is treated as infinitely wide (table +
   * 2-up charts); MapWorkspace always passes the live width.
   */
  panelWidthPx?: number;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

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

function incidentCategoryLabel(incident: IncidentDetail) {
  return incident.offense_category ? titleCase(incident.offense_category) : "Uncategorized";
}

function incidentSubtypeLabel(incident: IncidentDetail) {
  if (incident.offense_subcategory) return titleCase(incident.offense_subcategory);
  return incident.nibrs_group ? `NIBRS ${incident.nibrs_group}` : "All reported";
}

function incidentIdentifier(incident: IncidentDetail) {
  return incident.report_number || incident.external_incident_id || incident.incident_id;
}

function formatIncidentTime(value: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const date = [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(parsed.getUTCHours()).padStart(2, "0"),
    String(parsed.getUTCMinutes()).padStart(2, "0"),
  ].join(":");
  return `${date} ${time} UTC`;
}

function formatDistanceMeters(value: number) {
  return `${Math.round(value)} m`;
}

function findingEntries(summary: DashboardSummary | null, selected: Place[], radiusM: number) {
  const selectedIds = new Set(selected.map((place) => place.id));
  return (summary?.crime_summaries ?? []).filter(
    (entry) => selectedIds.has(entry.place_cluster_id) && entry.radius_m === radiusM,
  );
}

type ChartRow = {
  label: string;
  total: number;
  percent: number;
  tone: "person" | "property" | "other";
};

function percentOf(total: number, value: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function offenseLabel(entry: CrimeSummary) {
  if (entry.offense_subcategory) return titleCase(entry.offense_subcategory);
  if (entry.offense_category) return titleCase(entry.offense_category);
  return entry.nibrs_group ? `NIBRS ${entry.nibrs_group}` : "Uncategorized";
}

function buildCrimeMixRows(entries: CrimeSummary[]): ChartRow[] {
  const buckets: ChartRow[] = [
    { label: "Person / violent", total: 0, percent: 0, tone: "person" },
    { label: "Property", total: 0, percent: 0, tone: "property" },
    { label: "Other non-violent", total: 0, percent: 0, tone: "other" },
  ];

  for (const entry of entries) {
    if (entry.offense_category === "PERSON") buckets[0].total += entry.incident_count;
    else if (entry.offense_category === "PROPERTY") buckets[1].total += entry.incident_count;
    else buckets[2].total += entry.incident_count;
  }

  const total = buckets.reduce((sum, row) => sum + row.total, 0);
  return buckets.map((row) => ({ ...row, percent: percentOf(total, row.total) }));
}

function buildOffenseRows(entries: CrimeSummary[]): ChartRow[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const label = offenseLabel(entry);
    totals.set(label, (totals.get(label) ?? 0) + entry.incident_count);
  }

  const max = Math.max(0, ...totals.values());
  return Array.from(totals.entries())
    .map(([label, total]) => ({ label, total, percent: percentOf(max, total), tone: "property" as const }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, 6);
}

function BarList({ rows }: { rows: ChartRow[] }) {
  return (
    <div className="mc-chart-bars">
      {rows.map((row) => (
        <div className={`mc-chart-row tone-${row.tone}`} key={row.label}>
          <div className="mc-chart-label">
            <span>{row.label}</span>
            <strong>{row.total}</strong>
          </div>
          <div className="mc-chart-track" aria-hidden="true">
            <span className="mc-chart-fill" style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function IncidentCharts({ entries, wide }: { entries: CrimeSummary[]; wide: boolean }) {
  if (entries.length === 0) return null;

  const offenseRows = buildOffenseRows(entries);

  return (
    <section className={`mc-analysis-charts${wide ? " is-2up" : ""}`} aria-label="Reported incident charts">
      <div className="mc-chart-card">
        <div className="mc-breakdown-head">
          <h5>Crime mix</h5>
          <span>count</span>
        </div>
        <BarList rows={buildCrimeMixRows(entries)} />
      </div>
      <div className="mc-chart-card">
        <div className="mc-breakdown-head">
          <h5>Specific offenses</h5>
          <span>top {offenseRows.length}</span>
        </div>
        <BarList rows={offenseRows} />
      </div>
    </section>
  );
}

function buildFindings(summary: DashboardSummary | null, selected: Place[], radiusM: number) {
  if (selected.length === 0) {
    return ["Select one or more places to summarize reported incident patterns."];
  }

  const entries = findingEntries(summary, selected, radiusM);
  if (entries.length === 0) {
    return ["Run analysis to summarize reported incident patterns for the selected places."];
  }

  const selectedById = new Map(selected.map((place) => [place.id, place]));
  const placeTotals = new Map<string, number>();
  const typeTotals = new Map<string, { label: string; total: number }>();
  let hasAssault = false;

  for (const entry of entries) {
    placeTotals.set(entry.place_cluster_id, (placeTotals.get(entry.place_cluster_id) ?? 0) + entry.incident_count);

    const label = incidentTypeLabel(entry);
    const type = typeTotals.get(label) ?? { label, total: 0 };
    type.total += entry.incident_count;
    typeTotals.set(label, type);

    if (entry.offense_category === "PERSON" && entry.offense_subcategory === "ASSAULT") {
      hasAssault = true;
    }
  }

  const findings: string[] = [];

  if (selected.length === 1) {
    const [place] = selected;
    const total = placeTotals.get(place.id) ?? 0;
    findings.push(
      `${place.display_label} has ${total} matching reported incident${total === 1 ? "" : "s"} within ${radiusM} m for the selected filters.`,
    );
  } else {
    const highestPlace = Array.from(placeTotals.entries())
      .map(([placeId, total]) => ({ place: selectedById.get(placeId), total }))
      .filter((entry): entry is { place: Place; total: number } => Boolean(entry.place))
      .sort((a, b) => b.total - a.total)[0];

    if (highestPlace) {
      findings.push(
        `${highestPlace.place.display_label} has the highest reported incident count in the selected radius (${highestPlace.total} reported incidents).`,
      );
    }
  }

  const largestType = Array.from(typeTotals.values()).sort((a, b) => b.total - a.total)[0];
  if (largestType) {
    findings.push(`${largestType.label} is the largest reported incident type across the selected places.`);
  }

  if (hasAssault) {
    findings.push("Person / Assault appears in the selected places; use Compare for side-by-side context.");
  }

  return findings;
}

function IncidentDetailsTable({ details }: { details: IncidentDetailsResponse | null | undefined }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching reported incidents.`
    : `${details.total_count} matching reported incident${details.total_count === 1 ? "" : "s"}.`;

  return (
    <section className="mc-incident-details" aria-label="Reported incident details">
      <div className="mc-breakdown-head">
        <h5>Reported incidents near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching reported incidents for the selected filters.</p>
      ) : (
        <>
          <p className="mc-incident-count">{countText}</p>
          <div className="mc-incident-table-wrap">
            <table className="mc-incident-table">
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">Date/time</th>
                  <th scope="col">Category</th>
                  <th scope="col">Subcategory</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Block/address</th>
                  <th scope="col">ID</th>
                </tr>
              </thead>
              <tbody>
                {details.incidents.map((incident) => (
                  <tr key={`${incident.place_id}-${incident.incident_id}`}>
                    <td>{incident.place_label}</td>
                    <td>{formatIncidentTime(incident.occurred_at || incident.reported_at)}</td>
                    <td>{incidentCategoryLabel(incident)}</td>
                    <td>{incidentSubtypeLabel(incident)}</td>
                    <td>{formatDistanceMeters(incident.distance_m)}</td>
                    <td>{incident.block_address || "Unavailable"}</td>
                    <td>{incidentIdentifier(incident)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function IncidentDetailsCards({ details }: { details: IncidentDetailsResponse | null | undefined }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching reported incidents.`
    : `${details.total_count} matching reported incident${details.total_count === 1 ? "" : "s"}.`;

  return (
    <section className="mc-incident-details" aria-label="Reported incident details">
      <div className="mc-breakdown-head">
        <h5>Reported incidents near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching reported incidents for the selected filters.</p>
      ) : (
        <>
          <p className="mc-incident-count">{countText}</p>
          <div className="mc-incident-cards">
            {details.incidents.map((incident) => (
              <article className="mc-icard" key={`${incident.place_id}-${incident.incident_id}`}>
                <div className="mc-icard-top">
                  <strong>{incident.place_label}</strong>
                  <em>{formatDistanceMeters(incident.distance_m)}</em>
                </div>
                <div className="mc-icard-tags">
                  <span>{incidentCategoryLabel(incident)}</span>
                  <span>{incidentSubtypeLabel(incident)}</span>
                  <span>{formatIncidentTime(incident.occurred_at || incident.reported_at)}</span>
                </div>
                <p className="mc-icard-addr"><span>{incident.block_address || "Unavailable"}</span> · <span>{incidentIdentifier(incident)}</span></p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function AnalyzeTab({ selected, analysis, summary, availableRadii, running, incidentDetails, error, panelWidthPx, onChange, onRun }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const canRun = selected.length >= 1 && !running;
  const entries = findingEntries(summary, selected, analysis.radiusM);
  const findings = buildFindings(summary, selected, analysis.radiusM);
  const width = panelWidthPx ?? Infinity;
  const incidentLayout = width >= INCIDENT_TABLE_MIN ? "table" : "cards";
  const chartsWide = width >= CHARTS_TWO_UP_MIN;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Analyze">
      <div className="mc-querybar">
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

        <div className="mc-querybar-run">
          <span className="note">{selected.length} place{selected.length === 1 ? "" : "s"} · {analysis.radiusM} m</span>
          <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Running…" : "Run analysis"}</button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {running ? (
        <div className="mc-analysis-loading" aria-live="polite" aria-busy="true">
          <span className="mc-sr">Running analysis…</span>
          <div className="mc-skeleton" style={{ height: 84 }} />{/* findings */}
          <div className="mc-skeleton" style={{ height: 132 }} />{/* charts */}
          <div className="mc-skeleton" style={{ height: 168 }} />{/* incidents */}
        </div>
      ) : (
        <>
          <section className="mc-findings" aria-label="Findings summary">
            <div className="mc-findings-head">
              <h4>Findings summary</h4>
              <span>{analysis.radiusM} m</span>
            </div>
            <ul>
              {findings.map((finding) => <li key={finding}>{finding}</li>)}
            </ul>
            <p>Reported incident patterns do not predict personal risk.</p>
          </section>

          <IncidentCharts entries={entries} wide={chartsWide} />

          {incidentLayout === "table" ? (
            <IncidentDetailsTable details={incidentDetails} />
          ) : (
            <IncidentDetailsCards details={incidentDetails} />
          )}
        </>
      )}
    </div>
  );
}
