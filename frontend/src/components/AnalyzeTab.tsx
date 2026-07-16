import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AnalysisSettings,
  IncidentDetail,
  IncidentDetailsResponse,
  McppFeatureCollection,
  NeighborhoodAnalysis,
  NeighborhoodPlace,
  Place,
} from "../types";
import { formatIncidentAddress, titleCase } from "../lib/addressLabel";
import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { countNoun, incidentNoun, type IncidentNoun } from "../lib/layerCopy";
import { collectionBox, mosaicPath } from "../lib/locatorGeometry";
import { plotDomainMax } from "./BaselineIntervalPlot";
import type { LocatorData } from "./LocatorChip";
import { PlaceContextCard } from "./PlaceContextCard";
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
  /** True when rendered in the mobile bottom sheet; collapses the controls to a summary after a run. */
  isMobile?: boolean;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
  onCopyLink?: () => string | null;
  onCompareWith?: () => void;
  onSave?: () => void;
  onHoverPlace?: (placeId: string | null) => void;
  mcppPolygons?: McppFeatureCollection | null;
  onFlyTo?: (target: { latitude: number; longitude: number }) => void;
  /** Rendered above the querybar; the panel is absolutely positioned, so drawer-level
   * chrome (place chip strip, pin-draft popover) must live inside it to be visible. */
  topSlot?: ReactNode;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All reported" },
  { value: "PROPERTY", label: "Property" },
  { value: "PERSON", label: "Person" },
  { value: "SOCIETY", label: "Society" },
];

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
  // The SPD `offense_start_utc` field actually holds Seattle local wall-clock time (a known
  // column misnomer), and the getUTC* reads above pull those exact digits back out. Label it
  // "Seattle time" — calling it UTC misstated every incident time by 7-8 hours.
  return `${date} ${time} Seattle time`;
}

function formatDistanceMeters(value: number) {
  return `${Math.round(value)} m`;
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
                  {/* 911 calls carry no offense category — arrests carry a crosswalked one. */}
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
                    <td>{formatIncidentAddress(incident.block_address)}</td>
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
                <p className="mc-icard-addr"><span>{formatIncidentAddress(incident.block_address)}</span> · <span>{incidentIdentifier(incident)}</span></p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function AnalyzeTab({ selected, analysis, availableRadii, running, incidentDetails, neighborhood, error, panelWidthPx, isMobile = false, onChange, onRun, onCopyLink, onCompareWith, onSave, onHoverPlace, mcppPolygons, onFlyTo, topSlot }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];

  const resultsAnchorRef = useRef<HTMLDivElement>(null);
  const wasRunningRef = useRef(false);
  // On the mobile sheet, collapse the controls to a summary once a run has produced results, so the
  // tall control stack stops pushing the results off the visible fold. "Adjust" reopens them.
  const [editingControls, setEditingControls] = useState(false);
  useEffect(() => {
    if (wasRunningRef.current && !running) {
      if (isMobile) {
        // Collapse the controls to a summary; results then sit near the top with no scroll needed
        // (and the summary/Adjust row stays visible).
        setEditingControls(false);
      } else {
        // Desktop keeps the full controls, so scroll the results past them into view.
        resultsAnchorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    }
    wasRunningRef.current = running;
  }, [running, isMobile]);

  function coordsFor(place: NeighborhoodPlace, index: number): { latitude: number; longitude: number } | null {
    const match = selected.find((p) => p.id === place.place_id) ?? selected[index];
    return match && match.latitude != null && match.longitude != null
      ? { latitude: match.latitude, longitude: match.longitude }
      : null;
  }

  const locator = useMemo<LocatorData | null>(() => {
    if (!mcppPolygons) return null;
    const box = collectionBox(mcppPolygons);
    return box ? { polygons: mcppPolygons, box, mosaic: mosaicPath(mcppPolygons, box) } : null;
  }, [mcppPolygons]);
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
  const categoryLabel = CATEGORIES.find((c) => c.value === analysis.offenseCategory)?.label ?? "All reported";
  const showFullControls = !isMobile || !neighborhood || editingControls;

  return (
    <div className="mc-panel is-active has-querybar" role="tabpanel" aria-label="Analyze">
      {topSlot}
      {showFullControls ? (
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
      ) : (
      <div className="mc-querybar-summary">
        <span className="mc-querybar-sum">{selected.length} place{selected.length === 1 ? "" : "s"} · {analysis.radiusM} m{showCategory ? ` · ${categoryLabel}` : ""}</span>
        <button type="button" className="mc-querybar-edit" onClick={() => setEditingControls(true)}>Adjust</button>
      </div>
      )}

      <div ref={resultsAnchorRef} aria-hidden="true" />

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
          {neighborhood && (
            <div className="mc-analyze-actions">
              {onCopyLink && (
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
              {onCompareWith && (
                <button type="button" className="mc-link-copy mc-compare-bridge" onClick={onCompareWith}>
                  + Compare with another address
                </button>
              )}
              {onSave && (
                <button type="button" className="mc-link-copy mc-compare-bridge" onClick={onSave}>
                  Save to my places
                </button>
              )}
            </div>
          )}

          {(() => {
            const domainMax = plotDomainMax(neighborhood?.places ?? []);
            return neighborhood?.places?.map((place, index) => (
              <PlaceContextCard
                key={place.place_id}
                place={place}
                index={index}
                windowLabel={windowLabel}
                noun={noun}
                domainMax={domainMax}
                onHoverPlace={onHoverPlace}
                locator={locator}
                coords={coordsFor(place, index)}
                onFlyTo={onFlyTo}
              />
            ));
          })()}

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
