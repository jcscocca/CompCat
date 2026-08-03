import type { ReportReferenceDistribution } from "../types";

const KIND_ORDER = ["mcpp", "sector", "city"];

const ADEQUACY_COPY: Record<string, string> = {
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

function usable(reference: ReportReferenceDistribution): boolean {
  return reference.available
    && reference.p10 !== null
    && reference.p25 !== null
    && reference.median !== null
    && reference.p75 !== null
    && reference.p90 !== null
    && reference.share_below !== null
    && reference.share_equal !== null
    && reference.share_above !== null;
}

export function reportReferencePercentages(
  reference: ReportReferenceDistribution,
): [number, number, number] {
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

function computationLabel(reference: ReportReferenceDistribution): string {
  if (reference.computation === "exact") {
    return `Exact · all ${reference.reference_draw_count.toLocaleString()} frame memberships`;
  }
  if (reference.computation === "monte_carlo") {
    const margin = reference.monte_carlo_error === null
      ? ""
      : ` · ±${(reference.monte_carlo_error * 100).toFixed(1)} points`;
    return `Monte Carlo · ${reference.reference_draw_count.toLocaleString()} draws${margin}`;
  }
  return "Not calculated";
}

function componentLabel(reference: ReportReferenceDistribution): string {
  const labels = reference.geography_components.flatMap((component) => {
    const label = typeof component.label === "string" ? component.label : null;
    const weight = typeof component.weight === "number" ? component.weight : null;
    if (!label || weight === null) return [];
    const percent = weight * 100;
    return `${label} ${percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`}`;
  });
  return labels.length ? labels.join(" + ") : "—";
}

function warningLabel(reference: ReportReferenceDistribution): string {
  if (!reference.warnings.length) return "—";
  return reference.warnings
    .map((warning) => WARNING_COPY[warning] ?? warning.replaceAll("_", " "))
    .join(" ");
}

export function ReportReferencePlot({
  references,
  recordNounPlural,
}: {
  references: ReportReferenceDistribution[];
  recordNounPlural: string;
}) {
  const ordered = [...references].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  if (!ordered.length) return null;
  const available = ordered.filter(usable);
  const domainMax = Math.max(
    1,
    ...available.flatMap((reference) => [reference.target_count, reference.p90 ?? 0]),
  ) * 1.05;
  const pos = (value: number) => Math.max(0, Math.min(100, (value / domainMax) * 100));

  return (
    <section className="mc-reference mc-report-reference-plot" aria-label="Eligible-location reference distributions">
      <div className="mc-reference-head">
        <span className="mc-report-section-eyebrow">Selected count against equal-radius circles</span>
        <h5>Reference position</h5>
        <p>Observed counts in equal-radius circles under the report’s dates and filters.</p>
      </div>
      <div className="mc-reference-legend" aria-hidden="true">
        <span><i className="range" />10th–90th</span>
        <span><i className="middle" />middle 50%</span>
        <span><i className="target" />this place</span>
      </div>
      <div className="mc-reference-rows">
        {ordered.map((reference) => {
          if (!usable(reference)) {
            return (
              <div className="mc-reference-row is-unavailable" key={reference.kind}>
                <strong>{reference.label}</strong>
                <span>{ADEQUACY_COPY[reference.adequacy_status] ?? reference.adequacy_status.replaceAll("_", " ")}</span>
              </div>
            );
          }
          const [below, equal, above] = reportReferencePercentages(reference);
          const aria = `${reference.label}: target ${reference.target_count}; median ${reference.median}; middle 50 percent ${reference.p25} to ${reference.p75}; ${below} percent had fewer, ${equal} percent the same, ${above} percent more.`;
          return (
            <div className={`mc-reference-row kind-${reference.kind}`} key={reference.kind}>
              <div className="mc-reference-row-head">
                <strong>{reference.label}</strong>
                <span>{computationLabel(reference)}</span>
              </div>
              <div className="mc-reference-track" role="img" aria-label={aria}>
                <span className="mc-reference-whisker" style={{ left: `${pos(reference.p10!)}%`, width: `${Math.max(1, pos(reference.p90!) - pos(reference.p10!))}%` }} />
                <span className="mc-reference-iqr" style={{ left: `${pos(reference.p25!)}%`, width: `${Math.max(1, pos(reference.p75!) - pos(reference.p25!))}%` }} />
                <span className="mc-reference-median" style={{ left: `${pos(reference.median!)}%` }} />
                <span className="mc-reference-target" style={{ left: `${pos(reference.target_count)}%` }} title={`This place: ${reference.target_count}`} />
              </div>
              <div className="mc-report-reference-readout">
                <span>median <strong>{reference.median}</strong> · middle 50% <strong>{reference.p25}–{reference.p75}</strong></span>
                <span>
                  <strong>{below}%</strong> of comparable circles had fewer {recordNounPlural} ·{" "}
                  <strong>{equal}%</strong> had the same · <strong>{above}%</strong> had more
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mc-reference-note">
        These compare {recordNounPlural} among eligible street locations. They do not estimate
        how many records should occur or measure personal risk.
      </p>
      <details className="mc-analytical mc-reference-details">
        <summary>Reference details</summary>
        <div className="mc-reference-detail-grid">
          {ordered.map((reference) => (
            <section key={reference.kind} className="mc-reference-detail">
              <h6>{reference.label}</h6>
              <dl>
                <div><dt>Adequacy</dt><dd>{ADEQUACY_COPY[reference.adequacy_status] ?? reference.adequacy_status.replaceAll("_", " ")}</dd></div>
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
          <code>{ordered[0]?.sampling_frame_version ?? "—"}</code>
        </p>
      </details>
    </section>
  );
}
