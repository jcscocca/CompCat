import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareVerdictRow } from "../lib/compareVerdict";

// One shared axis of expected reported incidents per year within the buffer. Each place is a
// dot at its rate with a horizontal approximate 95% interval bar. A
// dashed line marks the lowest place's rate (with a fainter guide at the 1.25× effect floor),
// folding the "vs the lowest" comparison onto the same plot. The ranked verdict stays authoritative.
const MIN_REPORTS_FOR_INTERVAL = 3;

type PlotRow = {
  row: CompareVerdictRow;
  perYear: number;
  ciLow: number | null;
  ciHigh: number | null;
  intervalWithheld: boolean;
};

export function CompareRateNumberLine({ rows, noun, radiusM }: { rows: CompareVerdictRow[]; noun: IncidentNoun; radiusM: number }) {
  const plot: PlotRow[] = rows.map((row) => {
    const intervalWithheld = row.incidentCount < MIN_REPORTS_FOR_INTERVAL;
    return {
      row,
      perYear: annualIncidentsWithin(row.rate, radiusM),
      ciLow: !intervalWithheld && row.rateCiLow != null ? annualIncidentsWithin(row.rateCiLow, radiusM) : null,
      ciHigh: !intervalWithheld && row.rateCiHigh != null ? annualIncidentsWithin(row.rateCiHigh, radiusM) : null,
      intervalWithheld,
    };
  });
  const perYears = plot.map((p) => p.perYear);
  const highs = plot.map((p) => p.ciHigh).filter((v): v is number => v != null);
  const lowest = perYears.length ? Math.min(...perYears) : 0;
  const domainMax = Math.max(0.001, ...highs, ...perYears, lowest * 1.25) * 1.05;
  const pos = (v: number) => Math.max(0, Math.min(100, (v / domainMax) * 100));
  const ticks = [0, domainMax / 2, domainMax];

  return (
    <div className="mc-plot mc-numberline" data-testid="compare-numberline">
      <p className="mc-label">{noun.pluralCap} per year within {radiusM} m — approximate 95% interval</p>
      <div className="mc-plot-chart">
        <div className="mc-plot-guides" aria-hidden>
          <span className="name" />
          <div className="track">
            <span className="mc-plot-line same" style={{ left: `${pos(lowest)}%` }} />
            <span className="mc-plot-line floor" style={{ left: `${pos(lowest * 1.25)}%` }} />
          </div>
          <span className="val" />
        </div>
        {plot.map(({ row, perYear, ciLow, ciHigh, intervalWithheld }) => {
          const hasBar = ciLow != null && ciHigh != null;
          const left = hasBar ? pos(ciLow) : 0;
          const width = hasBar ? Math.max(1, pos(ciHigh) - left) : 0;
          return (
            <div className={`mc-plot-row ${row.relationship}${intervalWithheld ? " is-withheld" : ""}`} key={row.optionId}>
              <span className="name">{row.label}</span>
              <div className="track">
                {hasBar ? <span className="bar" style={{ left: `${left}%`, width: `${width}%` }} /> : null}
                <span className="dot" style={{ left: `${pos(perYear)}%` }} />
              </div>
              <span className="val">
                {formatPerYear(perYear)}
                {intervalWithheld ? <small>too few reports to put a range on</small> : null}
              </span>
            </div>
          );
        })}
        <div className="mc-plot-row mc-plot-axis" aria-hidden>
          <span className="name" />
          <div className="track">
            {ticks.map((t, i) => (
              <span className="tick" key={i} style={{ left: `${pos(t)}%` }}>{formatPerYear(t)}</span>
            ))}
          </div>
          <span className="val" />
        </div>
      </div>
      <p className="mc-plot-foot">Bars are approximate 95% intervals on each place’s {noun.singular} rate; the dashed line marks the lowest place’s rate. The bars are not adjusted for multiple comparisons. When intervals overlap, the statistically tested verdict above is authoritative.</p>
    </div>
  );
}
