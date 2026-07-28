import { useEffect, useMemo, useState } from "react";

import { anchorFactor, indexCitywide, rollingMean12 } from "../lib/trendMath";
import { useTrends } from "../lib/useTrends";
import type { LayerKey, NeighborhoodAnalysis } from "../types";
import { TrendChart } from "./TrendChart";

type TrendSectionProps = {
  neighborhood: NeighborhoodAnalysis;
  layer: LayerKey;
  category: string | null;
};

const TITLES: Record<LayerKey, string> = {
  reported: "Reported incident volume over time",
  arrests: "Arrest volume over time",
  calls: "911 call volume over time",
};
const COUNT_NOTES: Record<LayerKey, string> = {
  reported: "Counts are reported incidents, not verified events.",
  arrests: "Counts are arrests — enforcement activity, not reported incidents.",
  calls: "Counts are 911 calls — requests for service, not confirmed incidents.",
};
const INDEX_NOTE =
  "Citywide series is indexed to this area's scale — it shows direction, not magnitude.";
// anchorFactor indexes the citywide series on the first 12 months; with no incidents there
// the scaling factor is undefined. The old wording ("too few incidents") implied a
// threshold judgement rather than a division that cannot be performed.
const ANCHOR_SUPPRESSED_NOTE =
  "No incidents in the first 12 months of this window, so there's nothing to anchor the citywide line to.";
const SHORT_WINDOW_NOTE = "Not enough complete months for a trend view yet.";
const SHORT_WINDOW_MONTHS = 13;

export function TrendSection({ neighborhood, layer, category }: TrendSectionProps) {
  const labels = useMemo(() => {
    const out: string[] = [];
    for (const place of neighborhood.places) {
      const label = place.baselines?.find((b) => b.kind === "mcpp")?.label;
      if (label && !out.includes(label)) out.push(label);
    }
    return out;
  }, [neighborhood]);

  const [selected, setSelected] = useState<string | null>(labels[0] ?? null);
  useEffect(() => {
    setSelected((prev) => (prev && labels.includes(prev) ? prev : (labels[0] ?? null)));
  }, [labels]);

  const { data, loading, error } = useTrends(selected, layer, category);

  if (labels.length === 0) return null;

  const windowLabel = layer === "calls" ? "last 24 months — data floor" : "last 5 years";
  const subLabel = data?.mcpp_label ?? selected;
  const subtitle = `${subLabel} · ${windowLabel} · monthly · fixed window`;

  let body = null;
  if (loading) {
    body = <div className="mc-skeleton" style={{ height: 170 }} aria-busy="true" />;
  } else if (error) {
    body = (
      <p className="mc-inline-error" role="alert">
        {error}
      </p>
    );
  } else if (data) {
    const shortWindow = data.months.length < SHORT_WINDOW_MONTHS;
    const k = shortWindow ? null : anchorFactor(data.area_counts, data.citywide_counts);
    const rolling = shortWindow ? data.months.map(() => null) : rollingMean12(data.area_counts);
    const city = k == null ? null : indexCitywide(data.citywide_counts, k);
    const notes = [
      shortWindow ? SHORT_WINDOW_NOTE : k == null ? ANCHOR_SUPPRESSED_NOTE : INDEX_NOTE,
      // The series is neighborhood-wide; readers otherwise take it for their own radius.
      `Neighborhood-level trend (${data.mcpp_label}) — wider than your radius.`,
      COUNT_NOTES[layer],
    ];
    body = (
      <>
        <TrendChart
          months={data.months}
          area={data.area_counts}
          rolling={rolling}
          citywide={city}
          label={data.mcpp_label}
        />
        <div className="mc-trend-legend">
          <span>
            <i className="mc-trend-sw raw" />
            Monthly count
          </span>
          <span>
            <i className="mc-trend-sw rolling" />
            12-month average
          </span>
          {city ? (
            <span>
              <i className="mc-trend-sw city" />
              Citywide, indexed
            </span>
          ) : null}
        </div>
        {notes.map((note) => (
          <p key={note} className="mc-trend-note">
            {note}
          </p>
        ))}
      </>
    );
  }

  return (
    <section className="mc-trend" data-testid="trend-section" aria-label="Volume over time">
      <p className="mc-trend-title">{TITLES[layer]}</p>
      <p className="mc-trend-sub">{subtitle}</p>
      {labels.length > 1 ? (
        <div className="mc-chips" role="group" aria-label="Neighborhood">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className={`mc-chip${label === selected ? " on" : ""}`}
              aria-pressed={label === selected}
              onClick={() => setSelected(label)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {body}
    </section>
  );
}
