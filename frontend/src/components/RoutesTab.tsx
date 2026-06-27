import { useState } from "react";
import type { AnalysisSettings, RouteComparison } from "../types";

const PLACES = ["Capitol Hill", "Downtown Seattle", "Westlake Station", "Rainier Valley", "Ballard", "University District"];
const MODES: { value: string; label: string }[] = [
  { value: "transit", label: "Transit" },
  { value: "walk", label: "Walk" },
  { value: "bike", label: "Bike" },
  { value: "drive", label: "Drive" },
];

type Props = {
  analysis: AnalysisSettings;
  running: boolean;
  result?: RouteComparison | null;
  error?: string;
  onRun: (origin: string, destination: string, mode: string) => void;
};

function corridorContext(result: RouteComparison, alternativeId: string, radiusM: number) {
  const rows = result.context_summaries.filter(
    (s) => s.route_alternative_id === alternativeId && s.radius_m === radiusM,
  );
  const count = rows.reduce((sum, row) => sum + row.incident_count, 0);
  const nearestValues = rows.map((row) => row.nearest_incident_m).filter((v): v is number => v != null);
  const nearest = nearestValues.length ? Math.min(...nearestValues) : null;
  const types = [...new Set(rows.map((row) => row.offense_subcategory || row.offense_category).filter(Boolean))].slice(0, 3);
  return { count, nearest, types };
}

export function RoutesTab({ analysis, running, result, error, onRun }: Props) {
  const [origin, setOrigin] = useState("Capitol Hill");
  const [destination, setDestination] = useState("Downtown Seattle");
  const [mode, setMode] = useState("transit");
  const recommendedId = result?.statistical_comparison?.overview.recommendation_option_id ?? null;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Routes">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="route-origin">From</label>
          <select id="route-origin" className="mc-inp" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label htmlFor="route-destination">To</label>
          <select id="route-destination" className="mc-inp" value={destination} onChange={(e) => setDestination(e.target.value)}>
            {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label id="route-mode-label">Mode</label>
          <div className="mc-chips" role="group" aria-labelledby="route-mode-label">
            {MODES.map((m) => (
              <button key={m.value} type="button" className={`mc-chip${mode === m.value ? " on" : ""}`} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="mc-querybar-run">
          <button type="button" className="mc-cta" disabled={running} onClick={() => onRun(origin, destination, mode)}>
            {running ? "Routing…" : "Compare routes"}
          </button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {result ? (
        <>
          {result.statistical_comparison ? (
            <section className="mc-verdict tone-muted" aria-label="Route comparison verdict">
              <p className="mc-verdict-label">{result.statistical_comparison.overview.summary_text}</p>
              <p className="mc-verdict-sub">{result.statistical_comparison.overview.caveat_text}</p>
            </section>
          ) : (
            <p className="mc-empty-list">One route option — nothing to compare. Reported-incident context for the corridor is below.</p>
          )}

          {result.alternatives.map((alt) => {
            const ctx = corridorContext(result, alt.id, analysis.radiusM);
            return (
              <section key={alt.id} className={`mc-verdict${alt.id === recommendedId ? " tone-ok" : ""}`} aria-label={`Route ${alt.route_label}`}>
                <div className="mc-verdict-head">
                  <span className="mc-verdict-label">{alt.route_label}</span>
                  {alt.id === recommendedId ? <span className="cnt">recommended</span> : null}
                </div>
                <p className="mc-verdict-sub">
                  {alt.duration_minutes != null ? `${Math.round(alt.duration_minutes)} min` : "—"} · {alt.transfer_count} transfer{alt.transfer_count === 1 ? "" : "s"} · {alt.mode_mix}
                  {alt.walking_distance_m != null ? ` · ${Math.round(alt.walking_distance_m)} m walk` : ""}
                </p>
                <p className="mc-verdict-sub">
                  Corridor (≤{analysis.radiusM} m): {ctx.count} reported incident{ctx.count === 1 ? "" : "s"}
                  {ctx.nearest != null ? ` · nearest ${Math.round(ctx.nearest)} m` : ""}
                  {ctx.types.length ? ` · ${ctx.types.join(", ")}` : ""}
                </p>
              </section>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
