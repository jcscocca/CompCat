import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import type { IncidentNoun } from "../lib/layerCopy";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { BaselineEntry, NeighborhoodPlace } from "../types";

const KIND_ORDER: BaselineEntry["kind"][] = ["mcpp", "beat", "sector", "city"];
const MIN_REPORTS_FOR_INTERVAL = 3;

// "similar" asserted equivalence the test never established: failing to reject a null is
// not evidence of no difference. Say what was actually found.
const RELATION_TEXT: Record<BaselineEntry["relation"], string> = {
  above: "place is clearly above",
  below: "place is below",
  similar: "no clear difference",
  insufficient: "insufficient data",
};

/** Shared per-year axis domain across all plotted places: covers every place's CI and
 * every baseline tick, zero-anchored with 5% headroom, so the citywide tick lands in
 * the same visual position on every card. */
// Assumes one global radius per run (true today): mixing per-place radii would silently mix axis scales.
export function plotDomainMax(places: NeighborhoodPlace[]): number {
  let max = 0;
  for (const place of places) {
    const radius = place.radius_m;
    const values = [
      place.place_rate,
      place.place_incident_count >= MIN_REPORTS_FOR_INTERVAL
        ? place.place_rate_ci_upper
        : null,
    ];
    for (const v of values) {
      if (v != null) max = Math.max(max, annualIncidentsWithin(v, radius));
    }
    for (const entry of place.baselines ?? []) {
      max = Math.max(max, annualIncidentsWithin(entry.baseline_rate, radius));
    }
  }
  return max > 0 ? max * 1.05 : 1;
}

// The owned-interval plot: the place's 95% rate interval drawn ONCE as a continuous
// identity-tinted column behind equal baseline rows (bare tick + rate + relation).
// Relations render verbatim from the payload — the plot never re-derives them.
export function BaselineIntervalPlot({
  place,
  identity,
  noun,
  domainMax,
}: {
  place: NeighborhoodPlace;
  identity: PlaceIdentity;
  noun: IncidentNoun;
  domainMax: number;
}) {
  const radius = place.radius_m;
  if (place.place_rate == null) {
    return null;
  }
  const intervalWithheld = place.place_incident_count < MIN_REPORTS_FOR_INTERVAL;
  const hasBand = (
    !intervalWithheld
    && place.place_rate_ci_lower != null
    && place.place_rate_ci_upper != null
  );
  const pos = (ratePerKm2Day: number) =>
    Math.max(0, Math.min(100, (annualIncidentsWithin(ratePerKm2Day, radius) / domainMax) * 100));
  const bandLeft = hasBand ? pos(place.place_rate_ci_lower!) : 0;
  const bandWidth = hasBand ? Math.max(1, pos(place.place_rate_ci_upper!) - bandLeft) : 0;
  const entries = [...(place.baselines ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const perYear = (rate: number) => formatPerYear(annualIncidentsWithin(rate, radius));

  return (
    <div className={`mc-bplot id-${identity.slot}${intervalWithheld ? " is-withheld" : ""}`} data-testid="baseline-plot">
      <p className="mc-label">{noun.pluralCap} per year within {radius} m — approximate 95% interval</p>
      <div className="mc-bplot-chart">
        {hasBand ? <div className="mc-bplot-overlay" aria-hidden="true">
          <span className="name" />
          <span className="track">
            <span
              className="mc-bplot-band"
              style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
              title={`approximate 95% interval ${perYear(place.place_rate_ci_lower!)}–${perYear(place.place_rate_ci_upper!)} /yr`}
            />
          </span>
          <span className="val" />
        </div> : null}
        <div className="mc-bplot-row">
          <span className="name" data-testid="bplot-name">This place</span>
          <span className="track">
            {hasBand ? <span className="bar" aria-hidden="true" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} /> : null}
            <span className="dot" aria-hidden="true" style={{ left: `${pos(place.place_rate)}%` }} title={`${perYear(place.place_rate)} /yr`} />
          </span>
          <span className="val">{perYear(place.place_rate)} /yr</span>
        </div>
        {entries.map((entry) => (
          <div className="mc-bplot-row" key={entry.kind}>
            <span className="name" data-testid="bplot-name">{entry.label}</span>
            <span className="track">
              <span className="tickmark" aria-hidden="true" style={{ left: `${pos(entry.baseline_rate)}%` }} title={`${perYear(entry.baseline_rate)} /yr`} />
            </span>
            <span className="val">{perYear(entry.baseline_rate)} /yr · <em>{RELATION_TEXT[entry.relation]}</em></span>
          </div>
        ))}
        <div className="mc-bplot-foot" aria-hidden="true">
          <span className="name" />
          <span className="track">
            {hasBand ? (
              <span className="mc-bplot-bandlabel" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}>
                <i />{identity.letter}'s approx. 95% CI
              </span>
            ) : null}
            <span className="axis">
              <span style={{ left: "0%" }}>0</span>
              <span style={{ left: "50%" }}>{formatPerYear(domainMax / 2)}</span>
              <span style={{ left: "100%" }}>{formatPerYear(domainMax)} /yr</span>
            </span>
          </span>
          <span className="val" />
        </div>
      </div>
      {/* The baseline rows are area-time densities rescaled to this circle and window, not
          counts observed in the neighborhood — the header's "within {radius} m" applies to
          every row, which is easy to miss on the baseline ticks. */}
      {intervalWithheld ? <p className="mc-bplot-withheld">too few reports to put a range on</p> : null}
      <p className="mc-bplot-note">Baseline rows are scaled to your radius and window for comparison. The place's interval bar is not adjusted for multiple baseline comparisons.</p>
    </div>
  );
}
