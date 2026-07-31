import { useState } from "react";

type TrendChartProps = {
  months: string[]; // "YYYY-MM"
  area: number[];
  rolling: (number | null)[];
  citywide: number[] | null; // indexed values, or null (suppressed overlay)
  /** MCPP label for the aria description; the window is derived from months. */
  label?: string;
};

const W = 560,
  H = 170,
  PAD_L = 34,
  PAD_R = 8,
  PAD_T = 8,
  PAD_B = 20;

function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function TrendChart({ months, area, rolling, citywide, label }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const n = months.length;

  const provided: number[] = [
    ...area,
    ...rolling.filter((v): v is number => v != null),
    ...(citywide ?? []),
  ];
  const domainMax = Math.max(...provided, 1) * 1.05;

  const x = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const y = (v: number) => PAD_T + (1 - v / domainMax) * (H - PAD_T - PAD_B);

  const gridValues = [0, domainMax / 2, domainMax];
  const janTicks = months
    .map((m, i) => (m.endsWith("-01") ? i : -1))
    .filter((i) => i >= 0);

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || n === 0) return;
    const xInView = ((event.clientX - rect.left) / rect.width) * W;
    const t = (xInView - PAD_L) / (W - PAD_L - PAD_R);
    setHover(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  }

  const window = n ? `${months[0]}–${months[n - 1]}` : "";
  const readout =
    hover != null
      ? [
          `${months[hover]}: ${Math.round(area[hover] ?? 0)}`,
          `12-mo avg ${rolling[hover] == null ? "—" : Math.round(rolling[hover] as number)}`,
          citywide == null ? null : `citywide (indexed) ${Math.round(citywide[hover] ?? 0)}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className="mc-trend-chartwrap">
      {readout ? (
        <p className="mc-trend-readout" data-testid="trend-readout">
          {readout}
        </p>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        data-testid="trend-chart"
        role="img"
        aria-label={`Monthly volume${label ? ` for ${label}` : ""}${window ? `, ${window}` : ""}. Exact values are available in the data table that follows.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {gridValues.map((v, i) => (
          <g key={i}>
            <line className="mc-trend-grid" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
            <text className="mc-trend-tick" x={PAD_L - 4} y={y(v) + 3} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {janTicks.map((i) => (
          <text key={i} className="mc-trend-tick" x={x(i)} y={H - 6} textAnchor="middle">
            {months[i].slice(0, 4)}
          </text>
        ))}
        <path className="mc-trend-raw" data-testid="trend-raw" fill="none" d={linePath(area, x, y)} />
        {citywide ? (
          <path className="mc-trend-city" data-testid="trend-city" fill="none" d={linePath(citywide, x, y)} />
        ) : null}
        <path className="mc-trend-rolling" data-testid="trend-rolling" fill="none" d={linePath(rolling, x, y)} />
        {hover != null ? (
          <line className="mc-trend-cursor" x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} />
        ) : null}
      </svg>
      <details className="mc-chart-data">
        <summary>View monthly data</summary>
        <div className="mc-chart-data-wrap">
          <table className="mc-chart-data-table">
            <caption>Monthly trend values</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Monthly count</th>
                <th scope="col">12-month average</th>
                {citywide ? <th scope="col">Citywide indexed</th> : null}
              </tr>
            </thead>
            <tbody>
              {months.map((month, index) => (
                <tr key={month}>
                  <th scope="row">{month}</th>
                  <td>{Math.round(area[index] ?? 0)}</td>
                  <td>{rolling[index] == null ? "—" : Math.round(rolling[index] as number)}</td>
                  {citywide ? <td>{Math.round(citywide[index] ?? 0)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
