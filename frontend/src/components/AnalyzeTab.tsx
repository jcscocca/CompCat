import { useState } from "react";
import type {
  AnalysisSettings,
  CategoryShare,
  IncidentDetail,
  IncidentDetailsResponse,
  NeighborhoodAnalysis,
  NeighborhoodPlace,
  Place,
  TemporalProfile,
} from "../types";
import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { countNoun, incidentNoun, type IncidentNoun } from "../lib/layerCopy";
import { decisionHeadline } from "../lib/verdictCopy";
import {
  clampInt,
  DAYSET_DAYS,
  DAYSET_LABELS,
  DEFAULT_TRAVEL_WINDOW,
  DOW_LABELS,
  windowShare,
  type TravelWindow,
} from "../lib/temporalWindow";
import { MethodsAppendix } from "./MethodsAppendix";

const INCIDENT_TABLE_MIN = 560;

type Props = {
  selected: Place[];
  analysis: AnalysisSettings;
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
  onCopyLink?: () => string | null;
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

function ComparisonBars({ rateRatio }: { rateRatio: number }) {
  const CAP = 3;
  const width = (value: number) => `${(Math.min(value, CAP) / CAP) * 100}%`;
  return (
    <div className="mc-cmpbars" aria-hidden="true">
      <div className="mc-cmpbar">
        <span className="name">surrounding beat</span>
        <span className="track"><span className="fill beat" style={{ width: width(1) }} /></span>
        <span className="val">1.0×</span>
      </div>
      <div className="mc-cmpbar">
        <span className="name">this place</span>
        <span className="track"><span className="fill place" style={{ width: width(rateRatio) }} /></span>
        <span className="val">{rateRatio.toFixed(1)}×</span>
      </div>
    </div>
  );
}

function ProfileBars({
  counts,
  highlight,
  labelFor,
  summary,
}: {
  counts: number[];
  highlight: Set<number>;
  labelFor: (index: number) => string;
  summary: string;
}) {
  const max = Math.max(1, ...counts);
  return (
    <div className="mc-temporal-bars" role="img" aria-label={summary}>
      {counts.map((n, i) => (
        <span
          key={i}
          className={`mc-temporal-bar${highlight.has(i) ? " on" : ""}`}
          style={{ height: `${Math.round((n / max) * 100)}%` }}
          title={`${labelFor(i)}: ${n}`}
        />
      ))}
    </div>
  );
}

function TemporalSection({ temporal, windowLabel, noun }: { temporal: TemporalProfile; windowLabel: string; noun: IncidentNoun }) {
  const [tw, setTw] = useState<TravelWindow>(DEFAULT_TRAVEL_WINDOW);

  if (temporal.total_with_time === 0) {
    return (
      <div className="mc-temporal">
        <h6 className="mc-temporal-title">When {noun.plural} occurred</h6>
        <p className="mc-empty-list">No {noun.plural} with a recorded time in this area.</p>
      </div>
    );
  }

  const dayHighlight = new Set(DAYSET_DAYS[tw.dayset]);
  const hourHighlight = new Set<number>();
  for (let h = tw.startHour; h < tw.endHour; h += 1) hourHighlight.add(h);
  const { share } = windowShare(temporal, tw);
  const hourPeak = temporal.hour_counts.indexOf(Math.max(...temporal.hour_counts));
  const dayPeak = temporal.dow_counts.indexOf(Math.max(...temporal.dow_counts));

  return (
    <div className="mc-temporal">
      <h6 className="mc-temporal-title">When {noun.plural} occurred</h6>

      <div className="mc-temporal-profile">
        <span className="mc-temporal-axis">By hour</span>
        <ProfileBars
          counts={temporal.hour_counts}
          highlight={hourHighlight}
          labelFor={(h) => `${h}:00`}
          summary={`${noun.pluralCap} by hour of day; most around ${hourPeak}:00.`}
        />
      </div>
      <div className="mc-temporal-profile">
        <span className="mc-temporal-axis">By day</span>
        <ProfileBars
          counts={temporal.dow_counts}
          highlight={dayHighlight}
          labelFor={(d) => DOW_LABELS[d]}
          summary={`${noun.pluralCap} by day of week; most on ${DOW_LABELS[dayPeak]}.`}
        />
      </div>

      <div className="mc-temporal-window" role="group" aria-label="Travel window">
        <div className="mc-chips">
          {(["weekdays", "weekends", "all"] as const).map((ds) => (
            <button
              key={ds}
              type="button"
              className={`mc-chip${tw.dayset === ds ? " on" : ""}`}
              aria-pressed={tw.dayset === ds}
              onClick={() => setTw({ ...tw, dayset: ds })}
            >
              {DAYSET_LABELS[ds]}
            </button>
          ))}
        </div>
        <div className="mc-temporal-hours">
          <label>
            From
            <input
              type="number"
              min={0}
              max={23}
              value={tw.startHour}
              aria-label="Window start hour"
              onChange={(e) => setTw({ ...tw, startHour: clampInt(e.target.value, 0, 23) })}
            />
          </label>
          <label>
            to
            <input
              type="number"
              min={1}
              max={24}
              value={tw.endHour}
              aria-label="Window end hour"
              onChange={(e) => setTw({ ...tw, endHour: clampInt(e.target.value, 1, 24) })}
            />
          </label>
        </div>
      </div>

      <p className="mc-temporal-callout">
        {Math.round(share * 100)}% of the {temporal.total_with_time} {noun.plural} with a recorded time{windowLabel ? ` (${windowLabel})` : ""} fell in your travel window.
      </p>
      {temporal.total_with_time < 20 ? (
        <p className="mc-temporal-note">Based on {temporal.total_with_time} {countNoun(noun, temporal.total_with_time)} — interpret with caution.</p>
      ) : null}
      {temporal.without_time > 0 ? (
        <p className="mc-temporal-note">{temporal.without_time} {countNoun(noun, temporal.without_time)} had no recorded time and aren't shown here.</p>
      ) : null}
    </div>
  );
}

function CategoryBreakdown({ rows }: { rows: CategoryShare[] }) {
  if (!rows.length) return null;
  return (
    <div className="mc-cat-breakdown">
      <span className="mc-cat-title">Incident types</span>
      {rows.map((row) => (
        <div key={row.label} className="mc-cat-row">
          <span className="mc-cat-label">{row.label}</span>
          <span className="mc-cat-shares">
            {Math.round(row.place_share * 100)}% here
            {row.beat_share !== null
              ? ` · ${Math.round(row.beat_share * 100)}% nearby`
              : null}
          </span>
          <span className="mc-cat-bar" aria-hidden="true">
            <span className="mc-cat-fill place" style={{ width: `${Math.round(row.place_share * 100)}%` }} />
            {row.beat_share !== null ? (
              <span className="mc-cat-fill beat" style={{ width: `${Math.round(row.beat_share * 100)}%` }} />
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function VerdictCard({ place, windowLabel, noun }: { place: NeighborhoodPlace; windowLabel: string; noun: IncidentNoun }) {
  const { headline, chip } = decisionHeadline(place, noun);
  return (
    <section className="mc-verdict" aria-label={`Verdict for ${place.place_label}`}>
      <div className="mc-verdict-head">
        <span className={`mc-vchip ${chip.tone}`}>{chip.label}</span>
      </div>
      <p className="mc-verdict-headline">{headline}</p>
      {place.baseline_available ? (
        <>
          <p className="mc-verdict-sub">
            {place.place_incident_count} {countNoun(noun, place.place_incident_count)} within {place.radius_m} m · {windowLabel}
          </p>
          {place.rate_ratio != null ? <ComparisonBars rateRatio={place.rate_ratio} /> : null}
          {place.monthly_counts?.length ? (
            <div className="mc-spark" aria-hidden="true">
              {place.monthly_counts.map((n, i) => (
                <span key={i} style={{ height: `${barHeight(n, place.monthly_counts!)}%` }} />
              ))}
            </div>
          ) : null}
          <details className="mc-analytical">
            <summary>How we know</summary>
            <dl>
              <div><dt>Place vs beat rate</dt><dd>{place.place_rate != null && place.beat_rate != null ? `${place.place_rate.toFixed(2)} vs ${place.beat_rate.toFixed(2)} /km²·day` : "—"}</dd></div>
              <div><dt>95% CI (this comparison)</dt><dd>{place.ci_lower != null && place.ci_upper != null ? `${place.ci_lower.toFixed(1)}–${place.ci_upper.toFixed(1)}×` : "—"}</dd></div>
              <div><dt>Adjusted p-value</dt><dd>{place.adjusted_p_value != null ? place.adjusted_p_value.toFixed(3) : "—"}</dd></div>
              <div><dt>Exact p-value</dt><dd>{place.exact_p_value != null ? place.exact_p_value.toFixed(3) : "—"}</dd></div>
              <div><dt>Dispersion</dt><dd>{place.overdispersion_status}</dd></div>
              <div><dt>Method</dt><dd>{place.method}</dd></div>
              <div><dt>Adequacy</dt><dd>{place.minimum_data_status}</dd></div>
              <div><dt>Nearest</dt><dd>{place.nearest_incident_m != null ? `${Math.round(place.nearest_incident_m)} m` : "—"}</dd></div>
            </dl>
            <CategoryBreakdown rows={place.category_breakdown} />
          </details>
        </>
      ) : (
        <>
          <p className="mc-verdict-sub">{place.place_incident_count} {countNoun(noun, place.place_incident_count)} in range; no beat baseline.</p>
          <CategoryBreakdown rows={place.category_breakdown} />
        </>
      )}
      {place.temporal ? <TemporalSection temporal={place.temporal} windowLabel={windowLabel} noun={noun} /> : null}
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

function IncidentDetailsTable({ details, noun, showCategory, subcategoryHeader }: { details: IncidentDetailsResponse | null | undefined; noun: IncidentNoun; showCategory: boolean; subcategoryHeader: string }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching ${noun.plural}.`
    : `${details.total_count} matching ${countNoun(noun, details.total_count)}.`;

  return (
    <section className="mc-incident-details" aria-label={`${noun.pluralCap} near selected places`}>
      <div className="mc-breakdown-head">
        <h5>{noun.pluralCap} near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching {noun.plural} for the selected filters.</p>
      ) : (
        <>
          <p className="mc-incident-count">{countText}</p>
          <div className="mc-incident-table-wrap">
            <table className="mc-incident-table">
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">Date/time</th>
                  {/* calls and arrests carry no offense category — show only the type/charge column. */}
                  {showCategory ? <th scope="col">Category</th> : null}
                  <th scope="col">{subcategoryHeader}</th>
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
                    {showCategory ? <td>{incidentCategoryLabel(incident)}</td> : null}
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

function IncidentDetailsCards({ details, noun, showCategory }: { details: IncidentDetailsResponse | null | undefined; noun: IncidentNoun; showCategory: boolean; subcategoryHeader: string }) {
  if (!details) return null;

  const isCapped = details.total_count > details.returned_count;
  const countText = isCapped
    ? `Showing nearest ${details.returned_count} of ${details.total_count} matching ${noun.plural}.`
    : `${details.total_count} matching ${countNoun(noun, details.total_count)}.`;

  return (
    <section className="mc-incident-details" aria-label={`${noun.pluralCap} near selected places`}>
      <div className="mc-breakdown-head">
        <h5>{noun.pluralCap} near selected places</h5>
        <span>{details.radius_m} m</span>
      </div>
      {details.incidents.length === 0 ? (
        <p className="mc-empty-list">No matching {noun.plural} for the selected filters.</p>
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
                  {showCategory ? <span>{incidentCategoryLabel(incident)}</span> : null}
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

export function AnalyzeTab({ selected, analysis, availableRadii, running, incidentDetails, neighborhood, error, panelWidthPx, onChange, onRun, onCopyLink }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const canRun = selected.length >= 1 && !running;
  const width = panelWidthPx ?? Infinity;
  const incidentLayout = width >= INCIDENT_TABLE_MIN ? "table" : "cards";
  const windowLabel = neighborhood
    ? `${neighborhood.analysis_start_date} – ${neighborhood.analysis_end_date}`
    : "";

  const isCallsLayer = analysis.layer === "calls";
  const isArrestsLayer = analysis.layer === "arrests";
  const showCategory = analysis.layer !== "calls"; // reported + arrests carry offense categories; 911 calls do not
  const subcategoryHeader = isCallsLayer ? "Call type" : isArrestsLayer ? "Charge" : "Subcategory";
  const noun = incidentNoun(analysis.layer);

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Analyze">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="analysis-start-date">Date range</label>
          <div className="mc-inputs">
            <input id="analysis-start-date" type="date" className="mc-inp" value={analysis.startDate} min={ANALYSIS_MIN_DATE} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
            <input id="analysis-end-date" type="date" className="mc-inp" value={analysis.endDate} min={ANALYSIS_MIN_DATE} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
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

        {showCategory ? (
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
        ) : null}

        <div className="mc-querybar-run">
          <span className="note">{selected.length} place{selected.length === 1 ? "" : "s"} · {analysis.radiusM} m</span>
          <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>{running ? "Running…" : "Run analysis"}</button>
        </div>
      </div>

      {isCallsLayer ? (
        <p className="mc-layer-note" role="note">
          911 calls are <strong>requests for service</strong>, not confirmed incidents. The same
          event can generate several calls, many are proactive officer activity, and a call does
          not mean a crime occurred. Counts below are call volume, not reported crime.
        </p>
      ) : isArrestsLayer ? (
        <p className="mc-layer-note" role="note">
          Arrests are <strong>enforcement activity, not reported incidents</strong>. An arrest is
          logged where the arrest was made — which may differ from where an offense occurred — and
          most reported crimes never result in one. Categories are a <strong>best-effort</strong>{" "}
          NIBRS crosswalk from the arrest offense.
        </p>
      ) : null}

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
          {onCopyLink && neighborhood && (
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

          {neighborhood?.places?.map((place) => (
            <VerdictCard key={place.place_id} place={place} windowLabel={windowLabel} noun={noun} />
          ))}

          {neighborhood?.pairwise?.length ? <PairwiseSection neighborhood={neighborhood} /> : null}

          {incidentDetails && incidentDetails.incidents.length > 0 ? (
            <details className="mc-incident-reveal">
              <summary>See the {incidentDetails.total_count} {countNoun(noun, incidentDetails.total_count)}</summary>
              {incidentLayout === "table" ? (
                <IncidentDetailsTable details={incidentDetails} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
              ) : (
                <IncidentDetailsCards details={incidentDetails} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
              )}
            </details>
          ) : incidentLayout === "table" ? (
            <IncidentDetailsTable details={incidentDetails} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
          ) : (
            <IncidentDetailsCards details={incidentDetails} noun={noun} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
          )}

          <MethodsAppendix />
        </>
      )}
    </div>
  );
}
