import { useMemo, useState, type CSSProperties } from "react";

import { createBulkPlaces, createPlace, deletePlace } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { interpretToolResult } from "../lib/assistantBridge";
import { DRAWER_PEEK } from "../lib/drawer";
import { geocodingProvider } from "../lib/geocoding";
import { defaultTileConfig } from "../lib/mapTiles";
import { useAnalyze } from "../lib/useAnalyze";
import { useCompare } from "../lib/useCompare";
import { useDashboardData } from "../lib/useDashboardData";
import { useDrawer } from "../lib/useDrawer";
import { usePinDraft } from "../lib/usePinDraft";
import { useRoutes } from "../lib/useRoutes";
import { AnalyzeTab } from "./AnalyzeTab";
import { AssistantPanel } from "./AssistantPanel";
import { BottomSheet } from "./BottomSheet";
import { CompareTab } from "./CompareTab";
import { DataFreshness } from "./DataFreshness";
import { ExportTab } from "./ExportTab";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
import { PinDraftPopover } from "./PinDraftPopover";
import { PlaceSearch } from "./PlaceSearch";
import { PlacesTab } from "./PlacesTab";
import { RoutesTab } from "./RoutesTab";
import type { AnalysisSettings, AssistantDashboardState, PlaceCreate, TabKey } from "../types";

export function MapWorkspace() {
  const [activeTab, setActiveTab] = useState<TabKey>("places");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analysis, setAnalysis] = useState<AnalysisSettings>(() => {
    const window = currentYearAnalysisWindow();
    return { startDate: window.analysis_start_date, endDate: window.analysis_end_date, radiusM: 250, offenseCategory: "" };
  });

  const data = useDashboardData();
  const { drawer, setCollapsed: setDrawerCollapsed, onResize: onDrawerResize, onToggleCollapsed, onPreset } = useDrawer();
  const analyze = useAnalyze({ selectedIds, analysis, refreshWithFallback: data.refreshWithFallback, setError: data.setError });
  const compare = useCompare({ selectedIds, analysis, setError: data.setError });
  const routes = useRoutes(analysis);

  // Selection and analysis-control changes drop any current Analyze/Compare results (and
  // invalidate in-flight ones) so a stale pane never lingers against a new selection.
  function invalidateAnalysisContext() {
    analyze.invalidate();
    compare.invalidate();
  }

  function selectPlaceIds(ids: string[]) {
    if (ids.length === 0) return;
    invalidateAnalysisContext();
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  const pinDraft = usePinDraft({
    selectPlaceIds,
    refreshWithFallback: data.refreshWithFallback,
    setActiveTab,
    setDrawerCollapsed,
  });

  function handleToggleSelect(id: string) {
    invalidateAnalysisContext();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleAnalysisChange(patch: Partial<AnalysisSettings>) {
    invalidateAnalysisContext();
    setAnalysis((current) => ({ ...current, ...patch }));
  }

  async function handleDelete(id: string) {
    data.setError("");
    invalidateAnalysisContext();
    try {
      await deletePlace(id);
      setSelectedIds((current) => { const next = new Set(current); next.delete(id); return next; });
      await data.refreshWithFallback("Removed place, but dashboard totals could not refresh.");
    } catch {
      data.setError("Unable to remove place. Try again.");
    }
  }

  async function handleManualSubmit(place: PlaceCreate) {
    data.setError("");
    const created = await createPlace(place);
    selectPlaceIds([created.id]);
    await data.refreshWithFallback("Saved, but dashboard totals could not refresh.");
  }

  async function handleImport(csv: string) {
    data.setError("");
    const result = await createBulkPlaces(csv);
    selectPlaceIds(result.places.map((place) => place.id));
    await data.refreshWithFallback("Imported rows, but dashboard totals could not refresh.");
  }

  function applyAssistantToolResult(payload: { tool_name?: string; result?: unknown }) {
    const effect = interpretToolResult(payload);
    if (!effect) return;
    if (effect.settings) {
      setAnalysis((current) => ({ ...current, ...effect.settings }));
    }
    if (effect.selection) {
      const { mode, ids } = effect.selection;
      // Set the selection directly (NOT via selectPlaceIds) so it does NOT invalidate the
      // analysis context — the analyst-provided slices below must stick to the new selection.
      setSelectedIds((current) => {
        if (mode === "clear") return new Set<string>();
        if (mode === "replace") return new Set(ids);
        const next = new Set(current);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
    // The tool result is the source of truth for the panes it drives; clear the slice it does
    // NOT own so a prior manual Analyze/Compare does not leave stale data for the new selection.
    if (effect.comparison !== undefined) {
      analyze.invalidate();
      compare.applyAssistant(effect.comparison);
    }
    if (effect.neighborhood !== undefined || effect.incidents !== undefined) {
      compare.invalidate();
      analyze.applyAssistant({ neighborhood: effect.neighborhood, incidents: effect.incidents });
    }
    if (effect.refetchSummary) {
      void data.refreshWithFallback("Analyst updated the view, but dashboard totals could not refresh.");
    }
    if (effect.tab) setActiveTab(effect.tab);
  }

  const selected = useMemo(
    () => data.places.filter((place) => selectedIds.has(place.id)),
    [data.places, selectedIds],
  );
  const assistantState: AssistantDashboardState = useMemo(() => ({
    selected_place_ids: Array.from(selectedIds),
    analysis_start_date: analysis.startDate || null,
    analysis_end_date: analysis.endDate || null,
    radii_m: [analysis.radiusM],
    offense_category: analysis.offenseCategory || null,
    offense_subcategory: null,
    nibrs_group: null,
  }), [analysis, selectedIds]);

  return (
    <div className="mc-scope">
      <div
        className={`mc-frame${pinDraft.addPinMode ? " is-placing-pin" : ""}`}
        style={{ "--panel-width": `${drawer.collapsed ? DRAWER_PEEK : drawer.widthPx}px` } as CSSProperties}
      >
        <MapCanvas
          places={data.places}
          selectedIds={selectedIds}
          draft={pinDraft.draft}
          addPinMode={pinDraft.addPinMode}
          summary={data.summary}
          radiusM={analysis.radiusM}
          flyTo={pinDraft.flyTo}
          tileConfig={defaultTileConfig}
          onMapClick={pinDraft.handleMapClick}
          onMarkerClick={handleToggleSelect}
          routeLines={routes.routeLines}
        />

        <header className="mc-topbar">
          <div className="mc-brand">
            <span className="mc-logo">
              <svg width="16" height="16" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="#CD6A45" /><circle cx="12" cy="11.5" r="4.4" fill="#fff" /></svg>
            </span>
            <span className="mc-wordmark">Waypoint</span>
          </div>
          <div className="mc-topbar-right">
            <DataFreshness freshness={data.freshness} />
            <div className="mc-status"><span className="dot" />Public session - Seattle</div>
          </div>
        </header>

        <div className="mc-controls">
          <div className="mc-actionrow">
            <button
              type="button"
              className={`mc-addpin${pinDraft.addPinMode ? " is-armed" : ""}`}
              aria-pressed={pinDraft.addPinMode}
              onClick={() => (pinDraft.addPinMode ? pinDraft.setAddPinMode(false) : pinDraft.startAddPin())}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Add pin
            </button>
          </div>
          {pinDraft.addPinMode ? (
            <div className="mc-helper" role="status"><span className="cross" />Click the map to drop a pin - Esc to cancel</div>
          ) : null}
        </div>

        <MapLegend />

        <AssistantPanel dashboardState={assistantState} onToolResult={applyAssistantToolResult} />

        {data.error && activeTab !== "analyze" ? <p className="mc-error" role="alert">{data.error}</p> : null}

        {data.places.length === 0 && !pinDraft.draft ? (
          <div className="mc-empty">
            <h3>Map your places</h3>
            <p>Choose <strong>Add pin</strong> then click the map, or search for an address in the Places tab.</p>
          </div>
        ) : null}

        <BottomSheet
          activeTab={activeTab}
          onTabChange={setActiveTab}
          collapsed={drawer.collapsed}
          widthPx={drawer.widthPx}
          onToggleCollapsed={onToggleCollapsed}
          onResize={onDrawerResize}
          onPreset={onPreset}
          tabBadges={{ places: data.places.length, compare: selectedIds.size }}
        >
          {activeTab === "places" ? (
            <PlacesTab
              places={data.places}
              selectedIds={selectedIds}
              summary={data.summary}
              radiusM={analysis.radiusM}
              addPinMode={pinDraft.addPinMode}
              search={<PlaceSearch provider={geocodingProvider} onSelectResult={pinDraft.handleSearchSelect} />}
              draftPopover={pinDraft.draft ? (
                <PinDraftPopover
                  draft={pinDraft.draft}
                  saving={pinDraft.draftSaving}
                  error={pinDraft.draftError}
                  onChange={(patch) => pinDraft.setDraft((current) => (current ? { ...current, ...patch } : current))}
                  onSave={pinDraft.saveDraft}
                  onCancel={() => pinDraft.setDraft(null)}
                />
              ) : null}
              onStartAddPin={pinDraft.startAddPin}
              onToggleSelect={handleToggleSelect}
              onDelete={handleDelete}
              onManualSubmit={handleManualSubmit}
              onImportSubmit={handleImport}
              onUploaded={data.personalUploadsEnabled ? () => data.refreshWithFallback("Uploaded, but dashboard totals could not refresh.") : undefined}
            />
          ) : null}
          {activeTab === "analyze" ? (
            <AnalyzeTab
              selected={selected}
              analysis={analysis}
              availableRadii={data.availableRadii}
              running={analyze.running}
              incidentDetails={analyze.incidentDetails}
              neighborhood={analyze.neighborhood}
              error={data.error}
              panelWidthPx={drawer.widthPx}
              onChange={handleAnalysisChange}
              onRun={analyze.runAnalyze}
            />
          ) : null}
          {activeTab === "compare" ? (
            <CompareTab selected={selected} analysis={analysis} summary={data.summary} comparison={compare.comparison} running={compare.running} onRun={compare.runCompare} />
          ) : null}
          {activeTab === "routes" ? (
            <RoutesTab
              analysis={analysis}
              running={routes.running}
              result={routes.result}
              error={routes.error}
              places={data.places}
              geocodeSearch={geocodingProvider.search}
              onRun={routes.runRoute}
            />
          ) : null}
          {activeTab === "export" ? <ExportTab href={data.exportHref} /> : null}
        </BottomSheet>
      </div>
    </div>
  );
}
