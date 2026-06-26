import type {
  AnalysisSettings,
  DashboardSummary,
  IncidentDetail,
  IncidentDetailsResponse,
  NeighborhoodAnalysis,
  NeighborhoodPlace,
  Place,
} from "../types";
import { MethodsAppendix } from "./MethodsAppendix";

const INCIDENT_TABLE_MIN = 560;

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
  // TODO(Task 9): `summary` is no longer used here — drop it and its MapWorkspace pass-site when wiring neighborhood.
  summary: DashboardSummary | null;
  availableRadii: number[];
  running: boolean;
  incidentDetails?: IncidentDetailsResponse | null;
  /**
   * Neighborhood baseline analysis (place-vs-beat verdicts + pairwise
   * comparisons). Optional so callers that have not yet wired the fetch can
   * still render the controls and incident details. When present, one verdict
   * block renders per place and a pairwise section renders for each pair.
   */
  neighborhood?: NeighborhoodAnalysis | null;
  error?: string;
  /**
   * Current expanded drawer width in pixels, used to choose the incident
   * layout (cards below {@link INCIDENT_TABLE_MIN}, table at/above). When
   * omitted it is treated as infinitely wide (table); MapWorkspace always
   * passes the live width.
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

const DECISION_COPY: Record<NeighborhoodPlace["decision"], { label: string; tone: string }> = {
  above_clear: { label: "above its beat · statistically clear", tone: "hot" },
  below_clear: { label: "below its beat · statistically clear", tone: "ok" },
  not_clear: { label: "not statistically clear", tone: "muted" },
  insufficient_data: { label: "insufficient data", tone: "muted" },
  model_warning: { label: "needs analytical review", tone: "muted" },
  baseline_unavailable: { label: "neighborhood baseline unavailable", tone: "muted" },
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function barHeight(value: number, all: number[]) {
  const max = Math.max(1, ...all);
  return Math.round((value / max) * 100);
}

function VerdictBlock({ place }: { place: NeighborhoodPlace }) {
  const copy = DECISION_COPY[place.decision];
  return (
    <section className={`mc-verdict tone-${copy.tone}`} aria-label={`Verdict for ${place.place_label}`}>
      <div className="mc-verdict-head">
        {place.rate_ratio != null ? <span className="mc-ratio">{place.rate_ratio.toFixed(1)}×</span> : null}
        <span className="mc-verdict-label">{copy.label}</span>
      </div>
      {place.baseline_available ? (
        <>
          <p className="mc-verdict-sub">
            {place.place_label} vs beat {place.beat}: {place.place_rate?.toFixed(2)} vs {place.beat_rate?.toFixed(2)} /km²·day
            {place.ci_lower != null ? ` · 95% CI ${place.ci_lower.toFixed(1)}–${place.ci_upper?.toFixed(1)}×` : null}
          </p>
          {place.monthly_counts?.length ? (
            <div className="mc-spark" aria-hidden="true">
              {place.monthly_counts.map((n, i) => (
                <span key={i} style={{ height: `${barHeight(n, place.monthly_counts!)}%` }} />
              ))}
            </div>
          ) : null}
          <details className="mc-analytical">
            <summary>Analytical detail</summary>
            <dl>
              <div><dt>Adjusted p-value</dt><dd>{place.adjusted_p_value?.toFixed(3)}</dd></div>
              <div><dt>Dispersion</dt><dd>{place.overdispersion_status}</dd></div>
              <div><dt>Method</dt><dd>{place.method}</dd></div>
              <div><dt>Adequacy</dt><dd>{place.minimum_data_status}</dd></div>
              <div><dt>Nearest</dt><dd>{place.nearest_incident_m != null ? `${Math.round(place.nearest_incident_m)} m` : "—"}</dd></div>
            </dl>
            {place.type_mix?.length ? (
              <ul className="mc-typemix">
                {place.type_mix.map((t) => <li key={t.label}>{t.label} · {t.count}</li>)}
              </ul>
            ) : null}
          </details>
        </>
      ) : (
        <p className="mc-verdict-sub">{place.place_incident_count} reported incidents in range; no beat baseline.</p>
      )}
    </section>
  );
}

function PairwiseSection({ neighborhood }: { neighborhood: NeighborhoodAnalysis }) {
  if (!neighborhood.pairwise?.length) return null;
  return (
    <section className="mc-pairwise" aria-label="Pairwise comparisons">
      <div className="mc-breakdown-head">
        <h5>Place-to-place comparisons</h5>
        <span>{neighborhood.radius_m} m</span>
      </div>
      <ul>
        {neighborhood.pairwise.map((pair) => (
          <li key={`${pair.a_place_id}-${pair.b_place_id}`}>
            {pair.a_label} vs {pair.b_label}: {pair.rate_ratio.toFixed(1)}× · 95% CI {pair.ci_lower.toFixed(1)}–{pair.ci_upper.toFixed(1)}× · adj p {pair.adjusted_p_value.toFixed(3)}
          </li>
        ))}
      </ul>
    </section>
  );
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

export function AnalyzeTab({ selected, analysis, availableRadii, running, incidentDetails, neighborhood, error, panelWidthPx, onChange, onRun }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const canRun = selected.length >= 1 && !running;
  const width = panelWidthPx ?? Infinity;
  const incidentLayout = width >= INCIDENT_TABLE_MIN ? "table" : "cards";

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
          <div className="mc-skeleton" style={{ height: 96 }} />{/* verdict */}
          <div className="mc-skeleton" style={{ height: 96 }} />{/* verdict */}
          <div className="mc-skeleton" style={{ height: 168 }} />{/* incidents */}
        </div>
      ) : (
        <>
          {neighborhood?.places?.map((place) => <VerdictBlock key={place.place_id} place={place} />)}

          {neighborhood?.pairwise?.length ? <PairwiseSection neighborhood={neighborhood} /> : null}

          {incidentLayout === "table" ? (
            <IncidentDetailsTable details={incidentDetails} />
          ) : (
            <IncidentDetailsCards details={incidentDetails} />
          )}

          <MethodsAppendix />
        </>
      )}
    </div>
  );
}
