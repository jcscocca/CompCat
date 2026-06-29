import { useMemo, useState } from "react";
import { useAddressSearch } from "../lib/useAddressSearch";
import type { AnalysisSettings, GeocodeResult, Place, RouteComparison, RouteEndpointInput } from "../types";

const MODES: { value: string; label: string }[] = [
  { value: "transit", label: "Transit" },
  { value: "walk", label: "Walk" },
  { value: "bike", label: "Bike" },
  { value: "drive", label: "Drive" },
];

type EndpointOption = { key: string; label: string; input: RouteEndpointInput };

type Props = {
  analysis: AnalysisSettings;
  running: boolean;
  result?: RouteComparison | null;
  error?: string;
  places: Place[];
  geocodeSearch: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onRun: (origin: RouteEndpointInput, destination: RouteEndpointInput, mode: string) => void;
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

type LegContext = { label: string; count: number };

// Break the corridor total into per-leg context. Each context summary is anchored at one of
// the route's stops (context_label); group by that label so the user sees reported-incident
// context near each leg's stops, not just the whole-corridor sum.
function perLegContext(result: RouteComparison, alternativeId: string, radiusM: number): LegContext[] {
  const byLabel = new Map<string, number>();
  for (const row of result.context_summaries) {
    if (row.route_alternative_id !== alternativeId || row.radius_m !== radiusM) continue;
    const label = row.context_label?.trim();
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + row.incident_count);
  }
  return [...byLabel.entries()].map(([label, count]) => ({ label, count }));
}

function EndpointChooser({
  idBase,
  label,
  options,
  selectedKey,
  onSelect,
}: {
  idBase: string;
  label: string;
  options: EndpointOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const selected = options.find((option) => option.key === selectedKey) ?? null;
  const [open, setOpen] = useState(false);
  return (
    <div className="mc-field">
      <label id={`${idBase}-label`}>{label}</label>
      {selected && !open ? (
        <div className="mc-chosen">
          <span>{selected.label}</span>
          <button type="button" className="mc-chip" onClick={() => setOpen(true)}>Change</button>
        </div>
      ) : options.length > 0 ? (
        <ul className="mc-results" aria-label={`${label} options`}>
          {options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                aria-pressed={option.key === selectedKey}
                onClick={() => {
                  onSelect(option.key);
                  setOpen(false);
                }}
              >
                <span className="mc-result-label">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RoutesTab({ analysis, running, result, error, places, geocodeSearch, onRun }: Props) {
  const { query, setQuery, status: searchStatus, results: geoResults, runSearch } =
    useAddressSearch(geocodeSearch);
  const searchError =
    searchStatus === "error"
      ? "Address search failed. Try again."
      : searchStatus === "done" && geoResults.length === 0
        ? "No matches for that address."
        : "";
  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [mode, setMode] = useState("transit");

  const options: EndpointOption[] = useMemo(() => {
    const placeOptions = places.map((p) => ({
      key: `place:${p.id}`,
      label: p.display_label,
      input: { place_id: p.id } as RouteEndpointInput,
    }));
    const geoOptions = geoResults.map((g) => ({
      key: `geo:${g.latitude},${g.longitude}`,
      label: g.label,
      input: { latitude: g.latitude, longitude: g.longitude, label: g.label } as RouteEndpointInput,
    }));
    return [...placeOptions, ...geoOptions];
  }, [places, geoResults]);

  const recommendedId = result?.statistical_comparison?.overview.recommendation_option_id ?? null;
  const originOption = options.find((o) => o.key === originKey) ?? null;
  const destinationOption = options.find((o) => o.key === destinationKey) ?? null;
  const canRun = originOption !== null && destinationOption !== null && !running;

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Routes">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="route-address">Find an address</label>
          <div className="mc-field-row">
            <input
              id="route-address"
              className="mc-inp"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 400 Broad St, Seattle"
            />
            <button type="button" className="mc-chip" disabled={searchStatus === "loading"} onClick={() => void runSearch()}>
              {searchStatus === "loading" ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError ? <p className="mc-inline-error" role="alert">{searchError}</p> : null}
        </div>
        <EndpointChooser idBase="route-origin" label="From" options={options} selectedKey={originKey} onSelect={setOriginKey} />
        <EndpointChooser idBase="route-destination" label="To" options={options} selectedKey={destinationKey} onSelect={setDestinationKey} />
        <div className="mc-field">
          <label id="route-mode-label">Mode</label>
          <div className="mc-chips" role="group" aria-labelledby="route-mode-label">
            {MODES.map((m) => (
              <button key={m.value} type="button" className={`mc-chip${mode === m.value ? " on" : ""}`} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="mc-querybar-run">
          <button
            type="button"
            className="mc-cta"
            disabled={!canRun}
            onClick={() => { if (originOption && destinationOption) onRun(originOption.input, destinationOption.input, mode); }}
          >
            {running ? "Routing…" : "Compare routes"}
          </button>
        </div>
      </div>

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {options.length === 0 ? (
        <p className="mc-empty-list">Save places in the Places tab, or search an address above, to route between them.</p>
      ) : null}

      {result ? (
        result.alternatives.length === 0 ? (
          <p className="mc-empty-list">No route found between these points for this mode.</p>
        ) : (
          <>
            {result.statistical_comparison ? (
              <section className="mc-verdict tone-muted" aria-label="Route comparison verdict">
                <p className="mc-verdict-label">{result.statistical_comparison.overview.summary_text}</p>
                <p className="mc-verdict-sub">{result.statistical_comparison.overview.caveat_text}</p>
              </section>
            ) : result.alternatives.length === 1 ? (
              <p className="mc-empty-list">One route option — nothing to compare. Reported-incident context for the corridor is below.</p>
            ) : (
              <p className="mc-empty-list">{result.alternatives.length} route options below — not enough reported-incident context to rank them. Context for each corridor is shown per option.</p>
            )}

            {result.alternatives.map((alt) => {
              const ctx = corridorContext(result, alt.id, analysis.radiusM);
              const legs = perLegContext(result, alt.id, analysis.radiusM);
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
                  {legs.length > 1 ? (
                    <ul className="mc-breakdown" aria-label="Reported incidents near each leg's stops">
                      {legs.map((leg) => (
                        <li key={leg.label} className="mc-breakdown-row">
                          <span>{leg.label}</span>
                          <span className="cnt">{leg.count} reported incident{leg.count === 1 ? "" : "s"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </>
        )
      ) : null}
    </div>
  );
}
