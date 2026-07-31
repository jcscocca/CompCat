import type { IncidentNoun } from "../lib/layerCopy";
import type {
  NeighborhoodPlace,
  ReferenceCircleComparison,
} from "../types";

const KIND_ORDER: ReferenceCircleComparison["kind"][] = ["mcpp", "sector", "city"];

const ADEQUACY_COPY: Record<ReferenceCircleComparison["adequacy_status"], string> = {
  met: "Reference available",
  no_reference_geography: "No mapped reference geography covers this circle.",
  missing_reference_centers: "This geography has no eligible comparison locations.",
  insufficient_reference_centers: "Too few eligible comparison locations are available.",
  insufficient_polygon_coverage: "Too little of this circle is covered by the mapped geography.",
};

const WARNING_COPY: Record<string, string> = {
  low_reference_contrast: "Reference counts have little 10th–90th percentile spread.",
  multi_geography_context: "This row is an overlap-weighted mixture of mapped geographies.",
  partial_polygon_coverage: "Part of the circle falls outside the represented geography.",
  partial_reference_frame_coverage: "A mapped sliver had no eligible street centers.",
};

function usable(reference: ReferenceCircleComparison): boolean {
  return (
    reference.available
    && reference.p10 !== null
    && reference.p25 !== null
    && reference.median !== null
    && reference.p75 !== null
    && reference.p90 !== null
    && reference.share_below !== null
    && reference.share_equal !== null
    && reference.share_above !== null
  );
}

export function referencePercentages(reference: ReferenceCircleComparison): [number, number, number] {
  const values = [
    (reference.share_below ?? 0) * 100,
    (reference.share_equal ?? 0) * 100,
    (reference.share_above ?? 0) * 100,
  ];
  const rounded = values.map(Math.floor);
  let remaining = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of order) {
    if (remaining <= 0) break;
    rounded[item.index] += 1;
    remaining -= 1;
  }
  return rounded as [number, number, number];
}

export function primaryReference(place: NeighborhoodPlace): ReferenceCircleComparison | null {
  const references = [...(place.reference_comparisons ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  return references.find(usable) ?? null;
}

export function referenceSummary(
  place: NeighborhoodPlace,
  noun: IncidentNoun,
): string | null {
  const reference = primaryReference(place);
  if (!reference) return null;
  const [below, equal, above] = referencePercentages(reference);
  return `Among eligible street-centered circles in ${reference.label}, ${below}% had fewer ${noun.plural}, ${equal}% had the same number, and ${above}% had more.`;
}

function computationLabel(reference: ReferenceCircleComparison): string {
  if (reference.computation === "exact") {
    return `Exact · all ${reference.reference_draw_count.toLocaleString()} frame memberships`;
  }
  if (reference.computation === "monte_carlo") {
    const margin = reference.monte_carlo_error == null
      ? ""
      : ` · ±${(reference.monte_carlo_error * 100).toFixed(1)} points`;
    return `Monte Carlo · ${reference.reference_draw_count.toLocaleString()} draws${margin}`;
  }
  return "Not calculated";
}

function componentLabel(reference: ReferenceCircleComparison): string {
  if (!reference.geography_components.length) return "—";
  return reference.geography_components
    .map((component) => {
      const percent = component.weight * 100;
      const label = percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
      return `${component.label} ${label}`;
    })
    .join(" + ");
}

function warningLabel(reference: ReferenceCircleComparison): string {
  if (!reference.warnings.length) return "—";
  return reference.warnings
    .map((warning) => WARNING_COPY[warning] ?? warning.replaceAll("_", " "))
    .join(" ");
}

function ReferenceDetails({
  references,
  place,
}: {
  references: ReferenceCircleComparison[];
  place: NeighborhoodPlace;
}) {
  return (
    <details className="mc-analytical mc-reference-details">
      <summary>Reference details</summary>
      <dl className="mc-reference-target-detail">
        <div><dt>Target count</dt><dd>{place.place_incident_count}</dd></div>
        <div><dt>Nearest matching</dt><dd>{place.nearest_incident_m == null ? "—" : `${Math.round(place.nearest_incident_m)} m`}</dd></div>
      </dl>
      <div className="mc-reference-detail-grid">
        {references.map((reference) => (
          <section key={reference.kind} className="mc-reference-detail">
            <h6>{reference.label}</h6>
            <dl>
              <div><dt>Adequacy</dt><dd>{ADEQUACY_COPY[reference.adequacy_status]}</dd></div>
              <div><dt>Eligible centers</dt><dd>{reference.reference_center_count.toLocaleString()}</dd></div>
              <div><dt>Calculation</dt><dd>{computationLabel(reference)}</dd></div>
              <div><dt>Circle coverage</dt><dd>{(reference.covered_area_share * 100).toFixed(1)}%</dd></div>
              <div><dt>Components</dt><dd>{componentLabel(reference)}</dd></div>
              <div><dt>Notes</dt><dd>{warningLabel(reference)}</dd></div>
            </dl>
          </section>
        ))}
      </div>
      <p className="mc-reference-provenance">
        Sampling frame: open public Seattle street-segment midpoints · version{" "}
        <code>{references[0]?.sampling_frame_version ?? "—"}</code>
      </p>
    </details>
  );
}

export function ReferenceCirclePlot({
  place,
  noun,
}: {
  place: NeighborhoodPlace;
  noun: IncidentNoun;
}) {
  const references = [...(place.reference_comparisons ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  if (!references.length) return null;
  const available = references.filter(usable);
  const domainMax = Math.max(
    1,
    place.place_incident_count,
    ...available.map((reference) => reference.p90 ?? 0),
  ) * 1.05;
  const pos = (value: number) => Math.max(0, Math.min(100, (value / domainMax) * 100));

  return (
    <section className="mc-reference" aria-label="Eligible-location reference distributions">
      <div className="mc-reference-head">
        <h6>Compared with eligible street locations</h6>
        <p>Observed counts in equal-radius circles under the same dates and filters.</p>
      </div>
      <div className="mc-reference-legend" aria-hidden="true">
        <span><i className="range" />10th–90th</span>
        <span><i className="middle" />middle 50%</span>
        <span><i className="target" />this place</span>
      </div>
      <div className="mc-reference-rows">
        {references.map((reference) => {
          if (!usable(reference)) {
            return (
              <div className="mc-reference-row is-unavailable" key={reference.kind}>
                <strong>{reference.label}</strong>
                <span>{ADEQUACY_COPY[reference.adequacy_status]}</span>
              </div>
            );
          }
          const [below, equal, above] = referencePercentages(reference);
          const aria = `${reference.label}: target ${place.place_incident_count}; median ${reference.median}; middle 50 percent ${reference.p25} to ${reference.p75}; ${below} percent had fewer, ${equal} percent the same, ${above} percent more.`;
          return (
            <div className={`mc-reference-row kind-${reference.kind}`} key={reference.kind}>
              <div className="mc-reference-row-head">
                <strong>{reference.label}</strong>
                <span>median {reference.median} · middle 50% {reference.p25}–{reference.p75}</span>
              </div>
              <div className="mc-reference-track" role="img" aria-label={aria}>
                <span
                  className="mc-reference-whisker"
                  style={{ left: `${pos(reference.p10!)}%`, width: `${Math.max(1, pos(reference.p90!) - pos(reference.p10!))}%` }}
                />
                <span
                  className="mc-reference-iqr"
                  style={{ left: `${pos(reference.p25!)}%`, width: `${Math.max(1, pos(reference.p75!) - pos(reference.p25!))}%` }}
                />
                <span className="mc-reference-median" style={{ left: `${pos(reference.median!)}%` }} />
                <span
                  className="mc-reference-target"
                  style={{ left: `${pos(place.place_incident_count)}%` }}
                  title={`This place: ${place.place_incident_count}`}
                />
              </div>
              <p className="mc-reference-shares">
                <strong>{below}%</strong> fewer · <strong>{equal}%</strong> same · <strong>{above}%</strong> more
              </p>
            </div>
          );
        })}
      </div>
      <p className="mc-reference-note">
        These compare {noun.plural} among eligible street locations. They do not estimate how
        many incidents should occur.
      </p>
      <ReferenceDetails references={references} place={place} />
    </section>
  );
}
