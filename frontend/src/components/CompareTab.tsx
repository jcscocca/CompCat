import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import { toCompareVerdict } from "../lib/compareVerdict";
import { countNoun, incidentNoun } from "../lib/layerCopy";
import { collectionBox, mosaicPath } from "../lib/locatorGeometry";
import { CATEGORIES } from "../lib/offenseCategories";
import type { GeocodingProvider } from "../lib/geocoding";
import type { AddressEntry } from "../lib/useAddressList";
import { MAX_ADDRESSES, keyOf } from "../lib/useAddressList";
import type { AnalysisSettings, IncidentDetailsResponse, McppFeatureCollection, NeighborhoodAnalysis, SiteComparison } from "../types";
import { plotDomainMax } from "./BaselineIntervalPlot";
import { CompareAddressInput } from "./CompareAddressInput";
import { CompareRankedList } from "./CompareRankedList";
import { CompareRateNumberLine } from "./CompareRateNumberLine";
import { CompareVerdict } from "./CompareVerdict";
import { IncidentDetailsSection } from "./IncidentDetailsSection";
import type { LocatorData } from "./LocatorChip";
import { MethodsAppendix } from "./MethodsAppendix";
import { PlaceContextCard } from "./PlaceContextCard";
import { TrendSection } from "./TrendSection";

const INCIDENT_TABLE_MIN = 560;

type Props = {
  entries: AddressEntry[];
  provider: GeocodingProvider;
  onAddEntry: (entry: AddressEntry) => void;
  onRemoveEntry: (index: number) => void;
  /** Coord keys of saved places, so already-saved entries show "Saved" not "Save". */
  savedKeys: Set<string>;
  onSaveEntry: (entry: AddressEntry) => void;
  analysis: AnalysisSettings;
  availableRadii: number[];
  running: boolean;
  comparison: SiteComparison | null;
  neighborhood: NeighborhoodAnalysis | null;
  incidents: IncidentDetailsResponse | null;
  /** Snapshot of the points the results were computed from (coords, letters). */
  runPoints: AddressEntry[] | null;
  error?: string;
  panelWidthPx?: number;
  /** True in the mobile bottom sheet; collapses the controls to a summary after a run. */
  isMobile?: boolean;
  onChange: (patch: Partial<AnalysisSettings>) => void;
  onRun: () => void;
  onCopyLink?: () => string | null;
  onHoverPlace?: (savedPlaceId: string | null) => void;
  mcppPolygons?: McppFeatureCollection | null;
  onFlyTo?: (target: { latitude: number; longitude: number }) => void;
  /** Drawer-level chrome (chip strip, pin-draft popover) — must render inside the panel. */
  topSlot?: ReactNode;
};

const REVISED_CAVEAT =
  "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

export function CompareTab({ entries, provider, onAddEntry, onRemoveEntry, savedKeys, onSaveEntry, analysis, availableRadii, running, comparison, neighborhood, incidents, runPoints, error, panelWidthPx, isMobile = false, onChange, onRun, onCopyLink, onHoverPlace, mcppPolygons, onFlyTo, topSlot }: Props) {
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const noun = useMemo(() => incidentNoun(analysis.layer), [analysis.layer]);
  const canRun = entries.length >= 1 && !running;
  const hasResults = Boolean(neighborhood || comparison || incidents);

  const resultsAnchorRef = useRef<HTMLDivElement>(null);
  const wasRunningRef = useRef(false);
  const [editingControls, setEditingControls] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);
  useEffect(() => () => { if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current); }, []);
  function flashCopyState(next: "copied" | "failed") {
    setCopyState(next);
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }
  useEffect(() => {
    if (wasRunningRef.current && !running) {
      if (isMobile) {
        setEditingControls(false);
      } else {
        resultsAnchorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    }
    wasRunningRef.current = running;
  }, [running, isMobile]);

  const locator = useMemo<LocatorData | null>(() => {
    if (!mcppPolygons) return null;
    const box = collectionBox(mcppPolygons);
    return box ? { polygons: mcppPolygons, box, mosaic: mosaicPath(mcppPolygons, box) } : null;
  }, [mcppPolygons]);

  const width = panelWidthPx ?? Infinity;
  const incidentLayout = width >= INCIDENT_TABLE_MIN ? "table" : "cards";
  const windowLabel = neighborhood
    ? `${neighborhood.analysis_start_date} – ${neighborhood.analysis_end_date}`
    : "";

  const isCallsLayer = analysis.layer === "calls";
  const isArrestsLayer = analysis.layer === "arrests";
  const showCategory = analysis.layer !== "calls";
  const subcategoryHeader = isCallsLayer ? "Call type" : isArrestsLayer ? "Charge" : "Subcategory";
  const categoryLabel = CATEGORIES.find((c) => c.value === analysis.offenseCategory)?.label ?? "All reported";
  const showFullControls = !isMobile || !hasResults || editingControls;

  const verdict = comparison ? toCompareVerdict(comparison) : null;

  // Announce what the results actually contain — on the assistant path runPoints is
  // null and entries can lag behind the created ids, so input state can miscount.
  const announcedCount = comparison
    ? comparison.analytical.options.length
    : runPoints?.length ?? neighborhood?.places?.length ?? entries.length;
  const announcedNoun = announcedCount === 1 ? "address" : "addresses";
  const runAnnouncement = !running && hasResults
    ? comparison
      ? `Comparison complete: ${announcedCount} ${announcedNoun} ranked by ${noun.singular} rate.`
      : `Analysis complete for ${announcedCount} ${announcedNoun}.`
    : "";

  // One hover identity per entry: saved id when it exists, coordinate key otherwise —
  // matching the synthetic pin ids MapWorkspace renders for ad-hoc entries. Falls back
  // to the live entries when runPoints is absent (assistant-applied panes null it).
  function hoverIdFor(index: number): string | null {
    const point = runPoints?.[index] ?? entries[index];
    if (!point) return null;
    return point.savedPlaceId ?? keyOf(point);
  }

  function moduleFor(index: number): ReactNode | null {
    const place = neighborhood?.places?.[index];
    if (!place || !neighborhood) return null;
    const point = runPoints?.[index] ?? entries[index];
    return (
      <PlaceContextCard
        place={place}
        index={index}
        windowLabel={windowLabel}
        noun={noun}
        domainMax={plotDomainMax(neighborhood.places)}
        onHoverPlace={onHoverPlace ? (id) => onHoverPlace(id ? hoverIdFor(index) : null) : undefined}
        locator={locator}
        coords={point ? { latitude: point.latitude, longitude: point.longitude } : null}
        onFlyTo={onFlyTo}
      />
    );
  }

  const expansionByOptionId = useMemo(() => {
    if (!comparison || !neighborhood?.places?.length) return undefined;
    const map = new Map<string, ReactNode>();
    comparison.analytical.options.forEach((option, index) => {
      const node = moduleFor(index);
      if (node) map.set(option.id, node);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison, neighborhood, runPoints, noun, locator, onHoverPlace, onFlyTo]);

  const hoverIdByOptionId = useMemo(() => {
    if (!comparison) return undefined;
    const map = new Map<string, string | null>();
    comparison.analytical.options.forEach((option, index) => map.set(option.id, hoverIdFor(index)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison, runPoints, entries]);

  return (
    <div className="mc-panel is-active has-querybar" role="tabpanel" aria-label="Compare">
      {topSlot}
      <div className="mc-panel-head"><h4>Compare addresses</h4></div>

      <div className="mc-cmpset">
        <div className="mc-cmpset-head"><span className="mc-label">Addresses to compare · {entries.length} of {MAX_ADDRESSES}</span></div>
        <CompareAddressInput provider={provider} onAdd={onAddEntry} disabled={entries.length >= MAX_ADDRESSES} />
        {entries.length === 0 ? (
          <p className="mc-empty-list">Add at least one address to see its {noun.singular} context — two or more to compare.</p>
        ) : (
          <ul className="mc-cmpset-rows" aria-label="Addresses to compare">
            {entries.map((entry, index) => (
              <li key={keyOf(entry)} className="mc-cmpset-row">
                <span className="idx">{index + 1}</span>
                <span className="lbl">{entry.label}</span>
                {entry.savedPlaceId || savedKeys.has(keyOf(entry)) ? (
                  <span className="saved">Saved</span>
                ) : (
                  <button type="button" className="save" onClick={() => onSaveEntry(entry)}>Save</button>
                )}
                <button type="button" className="rm" aria-label={`Remove ${entry.label}`} onClick={() => onRemoveEntry(index)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showFullControls ? (
      <div className="mc-querybar">
        <div className="mc-field">
          <label htmlFor="analysis-start-date">Date range</label>
          <div className="mc-inputs">
            <input id="analysis-start-date" type="date" className="mc-inp" value={analysis.startDate} min={ANALYSIS_MIN_DATE} aria-label="Start date" onChange={(event) => onChange({ startDate: event.target.value })} />
            <input id="analysis-end-date" type="date" className="mc-inp" value={analysis.endDate} min={ANALYSIS_MIN_DATE} aria-label="End date" onChange={(event) => onChange({ endDate: event.target.value })} />
          </div>
        </div>

        <div className="mc-field">
          <label id="radius-label">Search radius</label>
          <div className="mc-chips" role="group" aria-labelledby="radius-label">
            {radii.map((value) => (
              <button key={value} type="button" className={`mc-chip${analysis.radiusM === value ? " on" : ""}`} aria-pressed={analysis.radiusM === value} onClick={() => onChange({ radiusM: value })}>
                {value} m
              </button>
            ))}
          </div>
        </div>

        {showCategory ? (
          <div className="mc-field">
            <label id="category-label">Incident categories</label>
            <div className="mc-chips" role="group" aria-labelledby="category-label">
              {CATEGORIES.map((category) => (
                <button key={category.value || "all"} type="button" className={`mc-chip${analysis.offenseCategory === category.value ? " on" : ""}`} aria-pressed={analysis.offenseCategory === category.value} onClick={() => onChange({ offenseCategory: category.value })}>
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mc-querybar-run">
          <span className="note">{entries.length} address{entries.length === 1 ? "" : "es"} · {analysis.radiusM} m</span>
          <button type="button" className="mc-cta" disabled={!canRun} onClick={onRun}>
            {running ? "Running…" : entries.length >= 2 ? `Compare ${entries.length} addresses` : "Run analysis"}
          </button>
        </div>
      </div>
      ) : (
      <div className="mc-querybar-summary">
        <span className="mc-querybar-sum">{entries.length} address{entries.length === 1 ? "" : "es"} · {analysis.radiusM} m{showCategory ? ` · ${categoryLabel}` : ""}</span>
        <button type="button" className="mc-querybar-edit" onClick={() => setEditingControls(true)}>Adjust</button>
      </div>
      )}

      <div ref={resultsAnchorRef} aria-hidden="true" />

      <p className="mc-sr" data-testid="run-announcement" role="status" aria-live="polite">
        {runAnnouncement}
      </p>

      {isCallsLayer ? (
        <p className="mc-layer-note" role="note">
          911 calls are <strong>requests for service</strong>, not confirmed incidents. The same
          event can generate several calls, many are proactive officer activity, and a call does
          not mean a crime occurred. Counts below are call volume, not reported crime.
        </p>
      ) : isArrestsLayer ? (
        <p className="mc-layer-note" role="note">
          Arrests are <strong>enforcement activity, not reported incidents</strong>. An arrest is
          logged where the arrest was made — which may differ from where an offense occurred — and
          most reported crimes never result in one. Categories are a <strong>best-effort</strong>{" "}
          NIBRS crosswalk from the arrest offense.
        </p>
      ) : null}

      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}

      {running ? (
        <div className="mc-analysis-loading" aria-live="polite" aria-busy="true">
          <span className="mc-sr">Running analysis…</span>
          <div className="mc-skeleton" style={{ height: 96 }} />
          <div className="mc-skeleton" style={{ height: 96 }} />
          <div className="mc-skeleton" style={{ height: 168 }} />
        </div>
      ) : (
        <>
          {hasResults && onCopyLink ? (
            <div className="mc-analyze-actions">
              <button
                type="button"
                className="mc-link-copy"
                onClick={async () => {
                  const url = onCopyLink();
                  if (!url) return;
                  try {
                    await navigator.clipboard.writeText(url);
                    flashCopyState("copied");
                  } catch {
                    flashCopyState("failed");
                  }
                }}
              >
                Copy link to this view
              </button>
              <span className="mc-copy-status" data-testid="copy-status" role="status" aria-live="polite">
                {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy — try again." : ""}
              </span>
            </div>
          ) : null}

          {verdict ? (
            <>
              <CompareVerdict callout={verdict.callout} noun={noun} />
              <p className="mc-ranked-title">Ranked by {noun.singular} rate — lowest first</p>
              <CompareRankedList
                rows={verdict.rows}
                noun={noun}
                radiusM={analysis.radiusM}
                expansionByOptionId={expansionByOptionId}
                onHoverRow={onHoverPlace ? (optionId) => onHoverPlace(optionId ? hoverIdByOptionId?.get(optionId) ?? null : null) : undefined}
              />
              {!expansionByOptionId ? (
                <p className="mc-search-msg">Per-address context unavailable for this run.</p>
              ) : null}
              <CompareRateNumberLine rows={verdict.rows} noun={noun} radiusM={analysis.radiusM} />
            </>
          ) : neighborhood?.places?.length ? (
            neighborhood.places.map((place, index) => <Fragment key={place.place_id}>{moduleFor(index)}</Fragment>)
          ) : null}

          {neighborhood ? (
            <TrendSection neighborhood={neighborhood} layer={analysis.layer} category={analysis.offenseCategory || null} />
          ) : null}

          {hasResults ? (
            <IncidentDetailsSection details={incidents} noun={noun} layout={incidentLayout} showCategory={showCategory} subcategoryHeader={subcategoryHeader} />
          ) : null}

          <div className="mc-caveat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
            {REVISED_CAVEAT}
          </div>

          <MethodsAppendix />
        </>
      )}
    </div>
  );
}
