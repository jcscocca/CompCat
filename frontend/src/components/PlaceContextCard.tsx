import { useState } from "react";

import type { CategoryShare, NeighborhoodPlace, TemporalProfile } from "../types";
import { isNotTested, methodLabel, minimumDataStatusLabel, NO_VALUE, NOT_TESTED_LABEL } from "../lib/analysisTerms";
import { countNoun, type IncidentNoun } from "../lib/layerCopy";
import { aggregateHeadline } from "../lib/verdictCopy";
import { placeIdentity } from "../lib/placeIdentity";
import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import { BaselineIntervalPlot } from "./BaselineIntervalPlot";
import {
  clampInt,
  DAYSET_DAYS,
  DAYSET_LABELS,
  DEFAULT_TRAVEL_WINDOW,
  DOW_LABELS,
  windowShare,
  type TravelWindow,
} from "../lib/temporalWindow";

export type PlaceContextCardProps = {
  place: NeighborhoodPlace;
  index: number;
  windowLabel: string;
  noun: IncidentNoun;
  domainMax: number;
  onHoverPlace?: (placeId: string | null) => void;
};

function barHeight(value: number, all: number[]) {
  const max = Math.max(1, ...all);
  return Math.round((value / max) * 100);
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
        <>
          <p className="mc-temporal-note">{temporal.without_time} {countNoun(noun, temporal.without_time)} had no recorded time and aren't shown here.</p>
          {timeConventionNote}
        </>
      ) : (
        timeConventionNote
      )}
    </div>
  );
}

const timeConventionNote = (
  <p className="mc-temporal-note">
    Times reflect each report's recorded offense start. Offenses reported as a time range (for
    example, an overnight break-in discovered in the morning) appear at the start of that range.
  </p>
);

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

function CoordinateCoverageNote({ coverage, noun }: { coverage: NeighborhoodPlace["coordinate_coverage"]; noun: IncidentNoun }) {
  if (!coverage || coverage.with_coordinates >= coverage.total) return null;
  return (
    <p className="mc-temporal-note">
      {coverage.with_coordinates} of {coverage.total} {noun.plural} in this area had usable coordinates; {noun.plural} without coordinates are excluded from the counts and map shown here.
    </p>
  );
}

export function PlaceContextCard({ place, index, windowLabel, noun, domainMax, onHoverPlace }: PlaceContextCardProps) {
  const identity = placeIdentity(index);
  const headline = aggregateHeadline(place, noun);
  return (
    <section
      className="mc-verdict"
      aria-label={`Context for ${place.place_label}`}
      onMouseEnter={() => onHoverPlace?.(place.place_id)}
      onMouseLeave={() => onHoverPlace?.(null)}
      onFocus={() => onHoverPlace?.(place.place_id)}
      onBlur={() => onHoverPlace?.(null)}
    >
      <div className="mc-verdict-head">
        <span className={`mc-idbadge id-${identity.slot}`} aria-hidden="true">{identity.letter}</span>
        <p className="mc-verdict-headline">{headline}</p>
      </div>
      {place.baseline_available ? (
        <>
          <p className="mc-verdict-sub">
            {place.place_incident_count} {countNoun(noun, place.place_incident_count)} within {place.radius_m} m · {windowLabel}
          </p>
          <BaselineIntervalPlot place={place} identity={identity} noun={noun} domainMax={domainMax} />
          {place.monthly_counts?.length ? (
            <div className="mc-spark" aria-hidden="true">
              {place.monthly_counts.map((n, i) => (
                <span key={i} style={{ height: `${barHeight(n, place.monthly_counts!)}%` }} />
              ))}
            </div>
          ) : null}
          <details className="mc-analytical">
            <summary>How we know</summary>
            {place.baselines.length > 0 ? (
              <div className="mc-incident-table-wrap">
                <table className="mc-incident-table mc-baseline-table">
                  <thead>
                    <tr><th scope="col">Baseline</th><th scope="col">Rate/yr</th><th scope="col">Ratio</th><th scope="col">approx. 95% CI</th><th scope="col">adj p</th><th scope="col">Method</th></tr>
                  </thead>
                  <tbody>
                    {place.baselines.map((b) => {
                      // An untested baseline still carries numbers; they are placeholders or
                      // under-powered noise, not a finding, so they render as "—".
                      const notTested = isNotTested(b);
                      return (
                        <tr key={b.kind}>
                          <td>{b.label}</td>
                          <td>{formatPerYear(annualIncidentsWithin(b.baseline_rate, place.radius_m))}</td>
                          <td>{notTested ? NO_VALUE : `${b.rate_ratio.toFixed(1)}×`}</td>
                          <td>{notTested ? NO_VALUE : `${b.ci_lower.toFixed(1)}–${b.ci_upper.toFixed(1)}×`}</td>
                          <td>{notTested ? NO_VALUE : b.adjusted_p_value.toFixed(3)}</td>
                          <td>{notTested ? NOT_TESTED_LABEL : methodLabel(b.method)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <dl>
              <div><dt>Baseline beats</dt><dd>{place.baseline_beats?.length ? place.baseline_beats.join(" + ") : (place.beat ?? "—")}</dd></div>
              <div><dt>Adequacy</dt><dd>{minimumDataStatusLabel(place.minimum_data_status)}</dd></div>
              <div><dt>Nearest</dt><dd>{place.nearest_incident_m != null ? `${Math.round(place.nearest_incident_m)} m` : "—"}</dd></div>
            </dl>
            <CategoryBreakdown rows={place.category_breakdown} />
          </details>
        </>
      ) : (
        <>
          <p className="mc-verdict-sub">{place.place_incident_count} {countNoun(noun, place.place_incident_count)} in range; no beat baseline.</p>
          <BaselineIntervalPlot place={place} identity={identity} noun={noun} domainMax={domainMax} />
          <CategoryBreakdown rows={place.category_breakdown} />
        </>
      )}
      <CoordinateCoverageNote coverage={place.coordinate_coverage} noun={noun} />
      {place.temporal ? <TemporalSection temporal={place.temporal} windowLabel={windowLabel} noun={noun} /> : null}
    </section>
  );
}
