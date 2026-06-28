import { useMemo, useState } from "react";
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

export function RoutesTab({ analysis, running, result, error, places, geocodeSearch, onRun }: Props) {
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [mode, setMode] = useState("transit");

  const options: EndpointOption[] = useMemo(() => {
    const placeOptions = places.map((p) => ({
      key: `place:${p.id}`,
      label: p.display_label,
      input: { place_id: p.id } as RouteEndpointInput,
    }));
    const geoOptions = geoResults.map((g, i) => ({
      key: `geo:${i}`,
      label: g.label,
      input: { latitude: g.latitude, longitude: g.longitude, label: g.label } as RouteEndpointInput,
    }));
    return [...placeOptions, ...geoOptions];
  }, [places, geoResults]);

  const recommendedId = result?.statistical_comparison?.overview.recommendation_option_id ?? null;
  const originOption = options.find((o) => o.key === originKey) ?? null;
  const destinationOption = options.find((o) => o.key === destinationKey) ?? null;
  const canRun = originOption !== null && destinationOption !== null && !running;

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError("");
    try {
      const results = await geocodeSearch(trimmed);
      setGeoResults(results);
      if (results.length === 0) setSearchError("No matches for that address.");
    } catch {
      setSearchError("Address search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Routes">
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="route-address">Find an address</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="route-address"
              className="mc-inp"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 400 Broad St, Seattle"
            />
            <button type="button" className="mc-chip" disabled={searching} onClick={handleSearch}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError ? <p className="mc-inline-error" role="alert">{searchError}</p> : null}
        </div>
        <div className="mc-field">
          <label htmlFor="route-origin">From</label>
          <select id="route-origin" className="mc-inp" value={originKey} onChange={(e) => setOriginKey(e.target.value)}>
            <option value="">Select a place…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="mc-field">
          <label htmlFor="route-destination">To</label>
          <select id="route-destination" className="mc-inp" value={destinationKey} onChange={(e) => setDestinationKey(e.target.value)}>
            <option value="">Select a place…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
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
        )
      ) : null}
    </div>
  );
}
