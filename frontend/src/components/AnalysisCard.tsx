import { titleCase } from "../lib/addressLabel";
import { toCompareVerdict } from "../lib/compareVerdict";
import { countNoun, incidentNoun, REVISED_CAVEAT } from "../lib/layerCopy";
import type { AnalysisCardData, IncidentDetailsResponse, LayerKey } from "../types";
import { plotDomainMax } from "./BaselineIntervalPlot";
import { CompareRankedList } from "./CompareRankedList";
import { CompareRateNumberLine } from "./CompareRateNumberLine";
import { CompareVerdict } from "./CompareVerdict";
import { IncidentDetailsSection } from "./IncidentDetailsSection";
import { MethodsAppendix } from "./MethodsAppendix";
import { PlaceContextCard } from "./PlaceContextCard";
import { TrendSection } from "./TrendSection";

type Props = {
  card: AnalysisCardData;
  expanded: boolean;
  historical?: boolean;
  onExpandChange: (expanded: boolean) => void;
  exportHrefBase: string;
};

/** Aggregate the frozen incident list by offense category, mirroring the expanded
 * incident table's labeling (titleCase, null → "Uncategorized") so compact bars and
 * expanded rows agree. Descending by count; empty when there are no incidents. */
export function categoryCounts(incidents: IncidentDetailsResponse | null): { label: string; count: number }[] {
  if (!incidents || incidents.incidents.length === 0) return [];
  const counts = new Map<string, number>();
  for (const item of incidents.incidents) {
    const label = item.offense_category ? titleCase(item.offense_category) : "Uncategorized";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function totalIncidentCount(card: AnalysisCardData): number | null {
  if (card.incidents) return card.incidents.total_count;
  if (card.comparison) return card.comparison.analytical.options.reduce((sum, o) => sum + o.incident_count, 0);
  if (card.neighborhood) return card.neighborhood.places.reduce((sum, p) => sum + p.place_incident_count, 0);
  return null;
}

export function AnalysisCard({ card, expanded, historical = false, onExpandChange, exportHrefBase }: Props) {
  const layer: LayerKey = card.settings.layer ?? "reported";
  const noun = incidentNoun(layer);
  const category = card.settings.offense_category ?? null;
  const radiusM = card.settings.radius_m ?? 0;
  const { analysis_start_date: start, analysis_end_date: end } = card.settings;
  const windowLabel = start && end ? `${start} – ${end}` : "";

  const comparison = card.comparison;
  const neighborhood = card.neighborhood;
  const verdict = comparison ? toCompareVerdict(comparison) : null;

  // 911 calls carry no offense category — a single "Uncategorized" bar says nothing.
  const cats = layer === "calls" ? [] : categoryCounts(card.incidents);
  const maxCat = cats.reduce((m, c) => Math.max(m, c.count), 0);
  const total = totalIncidentCount(card);
  const capped = card.incidents !== null && card.incidents.returned_count < card.incidents.total_count;
  const comparisonLabels = comparison?.analytical.options.map((option) => option.label) ?? [];
  const resultTitle = card.kind === "compare"
    ? comparisonLabels.length === 2
      ? `${comparisonLabels[0]} vs ${comparisonLabels[1]}`
      : `${comparisonLabels.length || card.placeIds.length} locations compared`
    : neighborhood?.places[0]?.place_label ?? "Location analysis";

  const showCategory = layer !== "calls";
  const subcategoryHeader = layer === "calls" ? "Call type" : layer === "arrests" ? "Charge" : "Subcategory";

  return (
    <article className={`mc-result-card${expanded ? " is-expanded" : ""}${historical ? " is-historical" : ""}`}>
      <header className="mc-result-head">
        <div className="mc-result-heading">
          <span className="mc-result-kind">{historical ? "Previous analysis" : card.kind === "compare" ? "Comparison" : "Analysis result"}</span>
          <h4 className="mc-result-title">{resultTitle}</h4>
        </div>
        <div className="mc-result-actions">
          {card.runId ? (
            <a className="mc-result-export" href={`${exportHrefBase}?run_id=${card.runId}`} download>
              Export CSV
            </a>
          ) : null}
          <button type="button" className="mc-result-toggle" aria-expanded={expanded} onClick={() => onExpandChange(!expanded)}>
            {expanded ? "Collapse" : "View details"}
          </button>
        </div>
      </header>

      {!expanded ? (
        <div className="mc-result-summary">
          {total !== null ? (
            <p className="mc-result-total">
              <strong>{total}</strong>
              <span>{countNoun(noun, total)}</span>
            </p>
          ) : null}

          {verdict ? <CompareVerdict callout={verdict.callout} noun={noun} /> : null}

          {cats.length ? (
            <div className="mc-result-minibars">
              {cats.map((c) => (
                <div className="mc-result-minibar" key={c.label}>
                  <span className="mc-result-minibar-label">{c.label}</span>
                  <span className="mc-result-minibar-track" aria-hidden="true">
                    <span className="mc-result-minibar-fill" style={{ width: `${Math.round((c.count / maxCat) * 100)}%` }} />
                  </span>
                  <span className="mc-result-minibar-count">{c.count}</span>
                </div>
              ))}
              {capped ? <p className="mc-result-minibar-note">of the {card.incidents!.returned_count} nearest</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mc-result-detail">
          {verdict ? (
            <section className="mc-result-comparison" aria-label="Comparison overview">
              <CompareVerdict callout={verdict.callout} noun={noun} />
              <CompareRateNumberLine rows={verdict.rows} noun={noun} radiusM={radiusM} />
              <CompareRankedList rows={verdict.rows} noun={noun} radiusM={radiusM} />
            </section>
          ) : null}
          {neighborhood ? (
            <div className="mc-result-places">
              {neighborhood.places.map((place, index) => (
                <PlaceContextCard
                  key={place.place_id}
                  place={place}
                  index={index}
                  windowLabel={windowLabel}
                  noun={noun}
                  domainMax={plotDomainMax(neighborhood.places)}
                  locator={null}
                  coords={null}
                />
              ))}
            </div>
          ) : null}
          {neighborhood ? <TrendSection neighborhood={neighborhood} layer={layer} category={category} /> : null}
          <IncidentDetailsSection details={card.incidents} noun={noun} layout="table" showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
          <div className="mc-caveat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            {REVISED_CAVEAT}
          </div>
          <MethodsAppendix />
        </div>
      )}
    </article>
  );
}
