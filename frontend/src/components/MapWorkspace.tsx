import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { createBulkPlaces, createPlace, deletePlace, getBeatPolygons, getMcppPolygons, updatePlace } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { compactGeocodeLabel } from "../lib/addressLabel";
import { interpretToolResult } from "../lib/assistantBridge";
import { DRAWER_PEEK, FOCUS_CHROME_MIN, MOBILE_MAX_WIDTH } from "../lib/drawer";
import { geocodingProvider } from "../lib/geocoding";
import { placeIdentity, type PlaceIdentity } from "../lib/placeIdentity";
import { decodeView, encodeView } from "../lib/savedView";
import { useIncidentPoints } from "../lib/useIncidentPoints";
import { useCompare } from "../lib/useCompare";
import { entriesFromPlaces, keyOf, useAddressList, type AddressEntry } from "../lib/useCompareSet";
import { useDashboardData } from "../lib/useDashboardData";
import { useDrawer } from "../lib/useDrawer";
import { usePersistedSelection } from "../lib/usePersistedSelection";
import { usePinDraft } from "../lib/usePinDraft";
import { useTheme } from "../lib/useTheme";
import { AddressLookup } from "./AddressLookup";
import { AssistantPanel } from "./AssistantPanel";
import { BottomSheet } from "./BottomSheet";
import { CompareTab } from "./CompareTab";
import { DataFreshness } from "./DataFreshness";
import { ExportTab } from "./ExportTab";
import { LayerToggle } from "./LayerToggle";
import { MapCanvas } from "./MapCanvas";
import { MapLegend } from "./MapLegend";
import { PinDraftPopover } from "./PinDraftPopover";
import { IncidentDisclosure } from "./IncidentDisclosure";
import { PlaceChipStrip } from "./PlaceChipStrip";
import { PlaceSearch } from "./PlaceSearch";
import { ManagePlacesModal, type ManageView } from "./ManagePlacesModal";
import { SearchPill } from "./SearchPill";
import { ThemeToggle } from "./ThemeToggle";
import type { AnalysisSettings, AssistantDashboardState, BeatFeatureCollection, GeocodeResult, LatLng, MapBounds, McppFeatureCollection, PlaceCreate, TabKey } from "../types";

export function MapWorkspace() {
  const { theme, setTheme } = useTheme();
  const initialView = useMemo(() => {
    const param = new URLSearchParams(window.location.search).get("view");
    return param ? decodeView(param) : null;
  }, []);
  const hadViewParam = useMemo(() => Boolean(new URLSearchParams(window.location.search).get("view")), []);
  const [sharedBanner, setSharedBanner] = useState(Boolean(initialView));
  const [showBadLink, setShowBadLink] = useState(hadViewParam && initialView === null);

  const [activeTab, setActiveTab] = useState<TabKey>("compare");
  const [chipFlyTo, setChipFlyTo] = useState<LatLng | null>(null);
  const [managePlaces, setManagePlaces] = useState<ManageView | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSettings>(() => {
    if (initialView) {
      return {
        startDate: initialView.startDate,
        endDate: initialView.endDate,
        radiusM: initialView.radiusM,
        offenseCategory: initialView.offenseCategory,
        layer: initialView.layer,
      };
    }
    const window = currentYearAnalysisWindow();
    return { startDate: window.analysis_start_date, endDate: window.analysis_end_date, radiusM: 250, offenseCategory: "", layer: "reported" };
  });
  const [beats, setBeats] = useState<BeatFeatureCollection | null>(null);
  const [viewport, setViewport] = useState<MapBounds | null>(null);

  useEffect(() => {
    getBeatPolygons().then(setBeats).catch(() => setBeats(null)); // outline layer is optional chrome
  }, []);

  const [mcppPolygons, setMcppPolygons] = useState<McppFeatureCollection | null>(null);
  useEffect(() => {
    getMcppPolygons().then(setMcppPolygons).catch(() => setMcppPolygons(null)); // locator chips are optional chrome
  }, []);

  const incidentLayer = useIncidentPoints({ bounds: viewport, analysis });

  const data = useDashboardData();
  const { selectedIds, setSelectedIds, restored } = usePersistedSelection(data.places);
  const [pendingAutoRun, setPendingAutoRun] = useState(false);
  const { drawer, setCollapsed: setDrawerCollapsed, onResize: onDrawerResize, onToggleCollapsed, onPreset } = useDrawer();

  // The single address list: seeded from the restored saved selection (share links replace
  // it on mount below). Saved ids write back through so returning sessions keep their list.
  const seedPlaces = useMemo(
    () => (initialView ? [] : data.places.filter((place) => selectedIds.has(place.id))),
    [initialView, data.places, selectedIds],
  );
  const list = useAddressList({
    seed: seedPlaces,
    // Never write back before the restore has run: an early lookup/share-link edit
    // must not mark the persisted selection dirty (that would skip the restore).
    onSavedIdsChange: (ids) => {
      if (restored) setSelectedIds(new Set(ids));
    },
  });

  // One identity source for cards AND pins: index within the list (saved entries carry
  // their place id so pins and chips can letter themselves).
  const identityByPlaceId = useMemo(
    () =>
      new Map<string, PlaceIdentity>(
        list.entries
          .map((entry, index) => [entry.savedPlaceId, placeIdentity(index)] as const)
          .filter((pair): pair is [string, PlaceIdentity] => Boolean(pair[0])),
      ),
    [list.entries],
  );
  const savedIdSet = useMemo(
    () => new Set(list.entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id))),
    [list.entries],
  );
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const savedPlaceKeys = useMemo(
    () =>
      new Set(
        data.places
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => keyOf({ latitude: p.latitude as number, longitude: p.longitude as number })),
      ),
    [data.places],
  );

  const compare = useCompare({
    entries: list.entries,
    analysis,
    setError: data.setError,
    onSummariesRefreshed: () => void data.refreshWithFallback("Ran, but dashboard totals could not refresh."),
  });

  // analyzed-beat highlight from the neighborhood payload
  const highlightBeats = useMemo(
    () =>
      (compare.neighborhood?.places ?? [])
        .map((place) => place.beat)
        .filter((beat): beat is string => Boolean(beat)),
    [compare.neighborhood],
  );

  // A ?view= link replaces the list on mount; the pending-auto-run effect below owns the
  // first run once the entries commit.
  useEffect(() => {
    if (!initialView) return;
    list.replaceAll(initialView.points);
    setPendingAutoRun(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Analysis greets you": one shot after the persisted selection seeds the list. Share
  // links own their first run above; landing lookups arm pendingAutoRun themselves.
  const autoRunArmedRef = useRef(false);
  useEffect(() => {
    if (autoRunArmedRef.current || initialView || !restored || list.edited) return;
    if (list.entries.length > 0) {
      autoRunArmedRef.current = true;
      setPendingAutoRun(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, list.entries.length]);

  useEffect(() => {
    if (!pendingAutoRun || list.entries.length === 0) return;
    setPendingAutoRun(false);
    void compare.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoRun, list.entries]);

  function invalidateAnalysisContext() {
    compare.invalidate();
  }

  // Resolve saved-place ids to list entries; ids whose places haven't loaded yet are
  // queued and appended when data.places refreshes (pin saves and assistant adds land
  // before the summary refetch completes).
  const pendingIdsRef = useRef<string[]>([]);
  function entriesForIds(ids: string[]): AddressEntry[] {
    const resolved: AddressEntry[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const place = data.places.find((p) => p.id === id);
      if (place && place.latitude != null && place.longitude != null) {
        resolved.push({ latitude: place.latitude, longitude: place.longitude, label: place.display_label, savedPlaceId: place.id });
      } else {
        missing.push(id);
      }
    }
    pendingIdsRef.current = [...pendingIdsRef.current, ...missing];
    return resolved;
  }
  useEffect(() => {
    if (pendingIdsRef.current.length === 0) return;
    const pending = pendingIdsRef.current;
    pendingIdsRef.current = [];
    const resolved = entriesForIds(pending);
    resolved.forEach((entry) => list.add(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.places]);

  function selectPlaceIds(ids: string[]) {
    if (ids.length === 0) return;
    invalidateAnalysisContext();
    setActiveTab("compare");
    entriesForIds(ids).forEach((entry) => list.add(entry));
  }

  const pinDraft = usePinDraft({
    selectPlaceIds,
    refreshWithFallback: data.refreshWithFallback,
    setActiveTab,
    setDrawerCollapsed,
  });

  // A newer search/preview target supersedes the last chip fly; chip clicks leave
  // pinDraft.flyTo untouched so this never fires for them.
  useEffect(() => {
    setChipFlyTo(null);
  }, [pinDraft.flyTo]);

  function handleLookup(result: GeocodeResult) {
    pinDraft.previewSearch(result);
    invalidateAnalysisContext();
    setSharedBanner(false);
    list.replaceAll([{ latitude: result.latitude, longitude: result.longitude, label: compactGeocodeLabel(result.label) }]);
    setActiveTab("compare");
    setPendingAutoRun(true);
  }

  function handleToggleSelect(id: string) {
    invalidateAnalysisContext();
    pinDraft.setDraft(null);
    setSharedBanner(false);
    const place = data.places.find((p) => p.id === id);
    if (place) list.toggleSaved(place);
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
      const entryIndex = list.entries.findIndex((e) => e.savedPlaceId === id);
      if (entryIndex >= 0) list.removeAt(entryIndex);
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
    if (effect.selection || effect.neighborhood !== undefined || effect.incidents !== undefined || effect.comparison !== undefined) {
      pinDraft.setDraft(null);
      setSharedBanner(false);
    }
    if (effect.settings) {
      setAnalysis((current) => ({ ...current, ...effect.settings }));
    }
    // Assistant selection edits invalidate like user edits; payload-bearing effects
    // re-apply their panes right below.
    if (effect.selection) compare.invalidate();
    if (effect.selection) {
      const { mode, ids } = effect.selection;
      if (mode === "clear") list.replaceAll([]);
      else if (mode === "replace") list.replaceAll(entriesForIds(ids));
      else entriesForIds(ids).forEach((entry) => list.add(entry));
    }
    if (effect.comparison !== undefined) {
      compare.applyAssistant({ comparison: effect.comparison });
    }
    if (effect.neighborhood !== undefined || effect.incidents !== undefined) {
      compare.applyAssistant({ neighborhood: effect.neighborhood, incidents: effect.incidents });
    }
    if (effect.refetchSummary) {
      void data.refreshWithFallback("Analyst updated the view, but dashboard totals could not refresh.");
    }
    if (effect.tab) setActiveTab(effect.tab);
  }

  const buildShareUrl = useCallback((): string | null => {
    const points = list.entries.map((e) => ({ latitude: Number(e.latitude.toFixed(3)), longitude: Number(e.longitude.toFixed(3)), label: e.label }));
    if (points.length === 0) return null;
    const encoded = encodeView({
      points, radiusM: analysis.radiusM,
      startDate: analysis.startDate, endDate: analysis.endDate,
      layer: analysis.layer, offenseCategory: analysis.offenseCategory,
    });
    return `${window.location.origin}/?view=${encoded}`;
  }, [list, analysis]);

  const assistantState: AssistantDashboardState = useMemo(() => ({
    selected_place_ids: Array.from(savedIdSet),
    analysis_start_date: analysis.startDate || null,
    analysis_end_date: analysis.endDate || null,
    radii_m: [analysis.radiusM],
    offense_category: analysis.offenseCategory || null,
    offense_subcategory: null,
    nibrs_group: null,
    layer: analysis.layer,
  }), [analysis, savedIdSet]);

  // Landing shows only on a truly fresh session: no saved data and no in-progress draft
  // (so a search preview or dropped pin reaches the chip strip + draft popover instead of
  // being hidden behind the landing).
  const showLanding =
    data.places.length === 0 && list.entries.length === 0 && activeTab === "compare" && !pinDraft.draft;

  // Recomputed every render: useDrawer's window-resize listener always produces a new
  // drawer object, so viewport changes re-render. No extra state needed.
  const isMobile = window.innerWidth <= MOBILE_MAX_WIDTH;
  // Focus mode is a desktop side-panel concept — force it off on mobile (the bottom sheet).
  const isFocus = !isMobile && !drawer.collapsed && window.innerWidth - drawer.widthPx < FOCUS_CHROME_MIN;

  // Below the breakpoint the panel is a bottom sheet and the layer controls live inside it.
  const layerControls = (
    <>
      <LayerToggle layer={analysis.layer} onChange={(layer) => handleAnalysisChange({ layer })} />
      <DataFreshness freshness={data.freshness} layer={analysis.layer} />
    </>
  );

  // Rendered INSIDE the Analyze/Compare panels (topSlot): .mc-panel is absolutely
  // positioned over .mc-panels, so a sibling rendered outside would be painted over.
  const drawerTopSlot = (
    <>
      <PlaceChipStrip
        places={data.places}
        identityByPlaceId={identityByPlaceId}
        onToggle={handleToggleSelect}
        onHoverPlace={setHoveredPlaceId}
        onAdd={() => setManagePlaces("manage")}
      />
      {pinDraft.draft ? (
        <PinDraftPopover
          draft={pinDraft.draft}
          saving={pinDraft.draftSaving}
          error={pinDraft.draftError}
          onChange={(patch) => pinDraft.setDraft((current) => (current ? { ...current, ...patch } : current))}
          onSave={pinDraft.saveDraft}
          onCancel={() => pinDraft.setDraft(null)}
        />
      ) : null}
    </>
  );

  return (
    <div className="mc-scope">
      <div
        className={`mc-frame${pinDraft.addPinMode ? " is-placing-pin" : ""}${isFocus ? " is-focus" : ""}`}
        style={{ "--panel-width": `${drawer.collapsed ? DRAWER_PEEK : drawer.widthPx}px` } as CSSProperties}
      >
        <MapCanvas
          places={data.places}
          selectedIds={savedIdSet}
          draft={pinDraft.draft}
          addPinMode={pinDraft.addPinMode}
          summary={data.summary}
          radiusM={analysis.radiusM}
          flyTo={chipFlyTo ?? pinDraft.flyTo}
          beats={beats}
          highlightBeats={highlightBeats}
          incidentPoints={incidentLayer.geojson}
          theme={theme}
          identityByPlaceId={identityByPlaceId}
          pulsePlaceId={hoveredPlaceId}
          onViewportChange={setViewport}
          onMapClick={pinDraft.handleMapClick}
          onMarkerClick={handleToggleSelect}
        />

        <header className="mc-topbar">
          <div className="mc-brand">
            <span className="mc-logo">
              <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 9 L4 4 L9 7 Q12 6 15 7 L20 4 L20 9 Q21.5 11.5 21.5 14 Q21.5 20 12 20 Q2.5 20 2.5 14 Q2.5 11.5 4 9 Z" fill="var(--on-accent)" /><circle cx="8.5" cy="13" r="1.3" fill="var(--accent)" /><circle cx="15.5" cy="13" r="1.3" fill="var(--accent)" /></svg>
            </span>
            <span className="mc-wordmark">CompCat</span>
          </div>
          <div className="mc-topbar-right">
            {!isMobile ? layerControls : null}
            {!isMobile ? <div className="mc-status"><span className="dot" />Public session - Seattle</div> : null}
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>

        <SearchPill
          search={(query, signal) => geocodingProvider.search(query, signal)}
          onSelect={handleLookup}
          addPinMode={pinDraft.addPinMode}
          onToggleAddPin={() => (pinDraft.addPinMode ? pinDraft.setAddPinMode(false) : pinDraft.startAddPin())}
        />
        {pinDraft.addPinMode ? (
          <div className="mc-helper" role="status"><span className="cross" />Click the map to drop a pin - Esc to cancel</div>
        ) : null}

        <MapLegend />
        <IncidentDisclosure
          returnedCount={incidentLayer.returnedCount}
          totalCount={incidentLayer.totalCount}
          unmappableCitywideCount={incidentLayer.unmappableCitywideCount}
          limit={incidentLayer.limit}
        />

        {data.error && showLanding ? <p className="mc-error" role="alert">{data.error}</p> : null}

        {sharedBanner ? (
          <div className="mc-banner" role="status">
            Shared view · reported incident context.{" "}
            <button
              type="button"
              onClick={() => {
                setSharedBanner(false);
                invalidateAnalysisContext();
                list.replaceAll(entriesFromPlaces(data.places.filter((p) => selectedIds.has(p.id))));
                setPendingAutoRun(true);
              }}
            >
              Exit
            </button>
          </div>
        ) : null}
        {showBadLink ? (
          <div className="mc-banner mc-banner-warn" role="alert">
            That shared link couldn't be opened.{" "}
            <button type="button" onClick={() => setShowBadLink(false)}>Dismiss</button>
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
          isMobile={isMobile}
          peekHeader={isMobile ? layerControls : undefined}
          tabBadges={{ compare: list.entries.length }}
          dock={<AssistantPanel dashboardState={assistantState} onToolResult={applyAssistantToolResult} defaultCollapsed={isMobile} />}
        >
          {showLanding ? (
            <AddressLookup provider={geocodingProvider} onSelect={handleLookup} onManual={() => setManagePlaces("manual")} />
          ) : (
            <>
          {activeTab === "compare" ? (
            <CompareTab
              topSlot={drawerTopSlot}
              entries={list.entries}
              provider={geocodingProvider}
              onAddEntry={(entry) => { invalidateAnalysisContext(); list.add(entry); }}
              onRemoveEntry={(index) => { invalidateAnalysisContext(); list.removeAt(index); }}
              savedKeys={savedPlaceKeys}
              onSaveEntry={async (entry) => {
                data.setError("");
                try {
                  const created = await createPlace({ display_label: entry.label, latitude: entry.latitude, longitude: entry.longitude, visit_count: 1, sensitivity_class: "normal" });
                  list.markSaved(keyOf(entry), created.id);
                  await data.refreshWithFallback("Saved, but your places list could not refresh.");
                } catch {
                  data.setError("Unable to save this address. Try again.");
                }
              }}
              analysis={analysis}
              availableRadii={data.availableRadii}
              comparison={compare.comparison}
              neighborhood={compare.neighborhood}
              incidents={compare.incidents}
              runPoints={compare.runPoints}
              running={compare.running}
              error={data.error}
              panelWidthPx={drawer.widthPx}
              isMobile={isMobile}
              onChange={handleAnalysisChange}
              onRun={compare.run}
              onCopyLink={buildShareUrl}
              onHoverPlace={setHoveredPlaceId}
              mcppPolygons={mcppPolygons}
              onFlyTo={({ latitude, longitude }) => setChipFlyTo({ lat: latitude, lng: longitude })}
            />
          ) : null}
          {activeTab === "export" ? (
            <ExportTab
              href={data.exportHref}
              places={data.places}
              onToggleExport={async (id, include) => {
                data.setError("");
                try {
                  await updatePlace(id, { sensitivity_class: include ? "normal" : "suppress_from_public_export" });
                  await data.refreshWithFallback("Updated export setting, but dashboard totals could not refresh.");
                } catch {
                  data.setError("Unable to update export setting. Try again.");
                }
              }}
            />
          ) : null}
            </>
          )}
        </BottomSheet>

        {managePlaces ? (
          <ManagePlacesModal
            places={data.places}
            selectedIds={savedIdSet}
            summary={data.summary}
            radiusM={analysis.radiusM}
            addPinMode={pinDraft.addPinMode}
            search={<PlaceSearch provider={geocodingProvider} onSelectResult={(result) => { setManagePlaces(null); pinDraft.handleSearchSelect(result); }} />}
            initialView={managePlaces}
            onStartAddPin={() => { setManagePlaces(null); pinDraft.startAddPin(); }}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDelete}
            onManualSubmit={handleManualSubmit}
            onImportSubmit={handleImport}
            onUploaded={data.personalUploadsEnabled ? () => data.refreshWithFallback("Uploaded, but dashboard totals could not refresh.") : undefined}
            onClose={() => setManagePlaces(null)}
            onRename={async (id, label) => {
              data.setError("");
              try {
                await updatePlace(id, { display_label: label });
                await data.refreshWithFallback("Renamed, but dashboard totals could not refresh.");
              } catch {
                data.setError("Unable to rename place. Try again.");
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
