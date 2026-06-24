import { useEffect, useMemo, useRef, useState } from "react";

import { analyzePlaces, comparePlaces, createBulkPlaces, createPlace, createSession, deletePlace, getDashboardSummary } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { geocodingProvider } from "../lib/geocoding";
import { defaultTileConfig } from "../lib/mapTiles";
import { AnalyzeTab } from "./AnalyzeTab";
import { BottomSheet } from "./BottomSheet";
import { CompareTab } from "./CompareTab";
import { ExportTab } from "./ExportTab";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
import { PinDraftPopover } from "./PinDraftPopover";
import { PlaceSearch } from "./PlaceSearch";
import { PlacesTab } from "./PlacesTab";
import type { AnalysisSettings, DashboardSummary, DraftPin, GeocodeResult, LatLng, Place, PlaceCreate, SheetState, TabKey } from "../types";

const DEFAULT_EXPORT = "/exports/tableau/place-summary.csv";

export function MapWorkspace() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("places");
  const [sheetState, setSheetState] = useState<SheetState>("half");
  const [addPinMode, setAddPinMode] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisSettings>(() => {
    const window = currentYearAnalysisWindow();
    return { startDate: window.analysis_start_date, endDate: window.analysis_end_date, radiusM: 250, offenseCategory: "PROPERTY" };
  });
  const comparisonVersionRef = useRef(0);

  const refresh = async () => {
    setSummary(await getDashboardSummary());
  };
  const refreshWithFallback = async (fallbackMessage: string) => {
    try {
      await refresh();
    } catch {
      setError(fallbackMessage);
    }
  };

  useEffect(() => {
    let isMounted = true;
    setError("");
    createSession()
      .then(() => getDashboardSummary())
      .then((next) => { if (isMounted) { setError(""); setSummary(next); } })
      .catch(() => { if (isMounted) { setError("Unable to start a dashboard session. Try again shortly."); } });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setAddPinMode(false); setDraft(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const places: Place[] = useMemo(() => summary?.places ?? [], [summary]);
  const selected = useMemo(() => places.filter((place) => selectedIds.has(place.id)), [places, selectedIds]);
  const availableRadii = summary?.analysis.available_radii_m ?? [];
  const exportHref = summary?.exports.tableau_place_summary_csv || DEFAULT_EXPORT;

  function invalidateComparison() {
    comparisonVersionRef.current += 1;
    setComparison(null);
  }

  function handleStartAddPin() {
    setAddPinMode(true);
    setActiveTab("places");
    if (sheetState === "peek") setSheetState("half");
  }

  function handleMapClick(latlng: LatLng) {
    if (!addPinMode) return;
    setDraft({ latitude: latlng.lat, longitude: latlng.lng, display_label: "", visit_count: 1, source: "map" });
    setDraftError("");
    setAddPinMode(false);
    setActiveTab("places");
    if (sheetState === "peek") setSheetState("half");
  }

  function handleSearchSelect(result: GeocodeResult) {
    setDraft({ latitude: result.latitude, longitude: result.longitude, display_label: result.label, visit_count: 1, source: "search" });
    setFlyTo({ lat: result.latitude, lng: result.longitude });
    setDraftError("");
    setActiveTab("places");
  }

  async function handleSaveDraft() {
    if (!draft || !draft.display_label.trim()) return;
    setDraftSaving(true);
    setDraftError("");
    try {
      await createPlace({
        display_label: draft.display_label.trim(),
        latitude: draft.latitude,
        longitude: draft.longitude,
        visit_count: draft.visit_count >= 1 ? draft.visit_count : 1,
        sensitivity_class: "normal",
      });
      setDraft(null);
      await refreshWithFallback("Saved, but dashboard totals could not refresh.");
    } catch {
      setDraftError("Unable to save pin. Try again.");
    } finally {
      setDraftSaving(false);
    }
  }

  function handleToggleSelect(id: string) {
    invalidateComparison();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    setError("");
    invalidateComparison();
    try {
      await deletePlace(id);
      setSelectedIds((current) => { const next = new Set(current); next.delete(id); return next; });
      await refreshWithFallback("Removed place, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to remove place. Try again.");
    }
  }

  async function handleManualSubmit(place: PlaceCreate) {
    setError("");
    await createPlace(place);
    await refreshWithFallback("Saved, but dashboard totals could not refresh.");
  }

  async function handleImport(csv: string) {
    setError("");
    await createBulkPlaces(csv);
    await refreshWithFallback("Imported rows, but dashboard totals could not refresh.");
  }

  async function handleAnalyze() {
    if (selectedIds.size < 1) return;
    setError("");
    setAnalyzing(true);
    try {
      await analyzePlaces({
        place_ids: Array.from(selectedIds),
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radii_m: [analysis.radiusM],
        offense_category: analysis.offenseCategory || null,
      });
      await refreshWithFallback("Analysis ran, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to run analysis. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCompare() {
    if (selectedIds.size < 2) return;
    setError("");
    setComparing(true);
    const version = comparisonVersionRef.current + 1;
    comparisonVersionRef.current = version;
    try {
      const result = await comparePlaces({
        place_ids: Array.from(selectedIds),
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radius_m: analysis.radiusM,
        offense_category: analysis.offenseCategory || null,
      });
      if (comparisonVersionRef.current === version) setComparison(result);
    } catch {
      if (comparisonVersionRef.current === version) setError("Unable to compare places. Try again.");
    } finally {
      setComparing(false);
    }
  }

  return (
    <div className="mc-scope">
      <div className="mc-frame">
        <MapCanvas
          places={places}
          selectedIds={selectedIds}
          draft={draft}
          addPinMode={addPinMode}
          summary={summary}
          radiusM={analysis.radiusM}
          flyTo={flyTo}
          tileConfig={defaultTileConfig}
          onMapClick={handleMapClick}
          onMarkerClick={handleToggleSelect}
        />

        <header className="mc-topbar">
          <div className="mc-brand">
            <span className="mc-logo">
              <svg width="16" height="16" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
            </span>
            <span className="mc-wordmark">Mobility&nbsp;Context</span>
          </div>
          <div className="mc-status"><span className="dot" />Public session - Seattle</div>
        </header>

        <div className="mc-controls">
          <div className="mc-actionrow">
            <button
              type="button"
              className={`mc-addpin${addPinMode ? " is-armed" : ""}`}
              aria-pressed={addPinMode}
              onClick={() => (addPinMode ? setAddPinMode(false) : handleStartAddPin())}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Add pin
            </button>
          </div>
          {addPinMode ? (
            <div className="mc-helper" role="status"><span className="cross" />Click the map to drop a pin - Esc to cancel</div>
          ) : null}
        </div>

        <MapLegend />

        {error ? <p className="mc-error" role="status">{error}</p> : null}

        {places.length === 0 && !draft ? (
          <div className="mc-empty">
            <h3>Map your places</h3>
            <p>Choose <strong>Add pin</strong> then click the map, or search for an address in the Places tab.</p>
          </div>
        ) : null}

        <BottomSheet
          activeTab={activeTab}
          onTabChange={setActiveTab}
          sheetState={sheetState}
          onSheetStateChange={setSheetState}
          tabBadges={{ places: places.length, compare: selectedIds.size }}
        >
          {activeTab === "places" ? (
            <PlacesTab
              places={places}
              selectedIds={selectedIds}
              summary={summary}
              radiusM={analysis.radiusM}
              addPinMode={addPinMode}
              search={<PlaceSearch provider={geocodingProvider} onSelectResult={handleSearchSelect} />}
              draftPopover={draft ? (
                <PinDraftPopover
                  draft={draft}
                  saving={draftSaving}
                  error={draftError}
                  onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
                  onSave={handleSaveDraft}
                  onCancel={() => setDraft(null)}
                />
              ) : null}
              onStartAddPin={handleStartAddPin}
              onToggleSelect={handleToggleSelect}
              onDelete={handleDelete}
              onManualSubmit={handleManualSubmit}
              onImportSubmit={handleImport}
            />
          ) : null}
          {activeTab === "analyze" ? (
            <AnalyzeTab
              selected={selected}
              analysis={analysis}
              availableRadii={availableRadii}
              running={analyzing}
              onChange={(patch) => setAnalysis((current) => ({ ...current, ...patch }))}
              onRun={handleAnalyze}
            />
          ) : null}
          {activeTab === "compare" ? (
            <CompareTab selected={selected} analysis={analysis} summary={summary} comparison={comparison} running={comparing} onRun={handleCompare} />
          ) : null}
          {activeTab === "export" ? <ExportTab href={exportHref} /> : null}
        </BottomSheet>
      </div>
    </div>
  );
}
