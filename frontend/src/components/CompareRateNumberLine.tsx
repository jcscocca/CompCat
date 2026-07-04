import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareVerdictRow } from "../lib/compareVerdict";

// One shared absolute-rate axis (0 → padded max). Each address is a dot at its rate with a
// horizontal 95% interval bar; overlapping bars = no clear difference. The corrected ranked
// verdict stays authoritative — see the footnote.
function makeScale(rows: CompareVerdictRow[]) {
  const highs = rows.map((r) => r.rateCiHigh).filter((v): v is number => v != null);
  const domainMax = Math.max(0.001, ...highs, ...rows.map((r) => r.rate)) * 1.05;
  const pos = (v: number) => Math.max(0, Math.min(100, (v / domainMax) * 100));
  return { pos, ticks: [0, domainMax / 2, domainMax] };
}

export function CompareRateNumberLine({ rows, noun }: { rows: CompareVerdictRow[]; noun: IncidentNoun }) {
  const { pos, ticks } = makeScale(rows);

  return (
    <div className="mc-plot mc-numberline" data-testid="compare-numberline">
      <p className="mc-label">Each address’s {noun.singular} rate — 95% interval</p>
      <div className="mc-plot-chart">
        {rows.map((r) => {
          const hasBar = r.rateCiLow != null && r.rateCiHigh != null;
          const left = hasBar ? pos(r.rateCiLow as number) : 0;
          const width = hasBar ? Math.max(1, pos(r.rateCiHigh as number) - left) : 0;
          return (
            <div className={`mc-plot-row ${r.relationship}`} key={r.optionId}>
              <span className="name">{r.label}</span>
              <div className="track">
                {hasBar ? <span className="bar" style={{ left: `${left}%`, width: `${width}%` }} /> : null}
                <span className="dot" style={{ left: `${pos(r.rate)}%` }} />
              </div>
              <span className="val">{r.rate.toFixed(1)}</span>
            </div>
          );
        })}
        <div className="mc-plot-row mc-plot-axis" aria-hidden>
          <span className="name" />
          <div className="track">
            {ticks.map((t, i) => (
              <span className="tick" key={i} style={{ left: `${pos(t)}%` }}>{t.toFixed(1)}</span>
            ))}
          </div>
          <span className="val" />
        </div>
      </div>
      <p className="mc-plot-foot">Bars are raw 95% intervals on each address’s {noun.singular} rate; when intervals overlap, the ranked verdict above is authoritative.</p>
    </div>
  );
}
