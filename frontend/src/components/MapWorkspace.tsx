// MapWorkspace is the dashboard's central coordinator, not a thin shell: focused data/UI
// concerns live in hooks (useDrawer / useDashboardData / usePinDraft / useCompare /
// useAddressList), but the cross-cutting glue — selection state, analysis-context
// invalidation, and the assistant tool-result fan-out — deliberately stays here so those slices
// stay in sync. It is large by design; further extraction candidates (auto-run card synthesis,
// the selection orchestrator, assistant-effect application) are noted in the repo review.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { createBulkPlaces, createPlace, deleteAllPlaces, deletePlace, friendlyMessageOr, getBeatPolygons, SESSION_EXPIRED_MESSAGE, updatePlace, type AssistantCommandName } from "../api/client";
import { availableDataAnalysisWindow, currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { compactGeocodeLabel } from "../lib/addressLabel";
import { interpretToolResult } from "../lib/assistantBridge";
import { buildRerunArgs, followupChipsFor, type FollowupChip } from "../lib/followupChips";
import { offerForPlaces, type SavedPlaceRef } from "../lib/offers";
import { clampWidth, DRAWER_DETAIL, DRAWER_RAIL, DRAWER_WIDE, FOCUS_CHROME_MIN, isCompactDesktopViewport, isMobileViewport, snapHeightPx } from "../lib/drawer";
import { geocodingProvider } from "../lib/geocoding";
import { cardWithSavedPlaceIds } from "../lib/localCard";
import { incidentNoun } from "../lib/layerCopy";
import { categoryLabel } from "../lib/offenseCategories";
import { placeIdentity, type PlaceIdentity } from "../lib/placeIdentity";
import { clearRecentPlaces } from "../lib/searchHistory";
import { decodeView, encodeView } from "../lib/savedView";
import { useIncidentPoints } from "../lib/useIncidentPoints";
import { useAreaSelection } from "../lib/useAreaSelection";
import { useCompare } from "../lib/useCompare";
import { entriesFromPlaces, keyOf, useAddressList, type AddressEntry } from "../lib/useAddressList";
import { useDashboardData } from "../lib/useDashboardData";
import { useDrawer } from "../lib/useDrawer";
import { usePersistedSelection } from "../lib/usePersistedSelection";
import { usePinDraft } from "../lib/usePinDraft";
import { useTheme } from "../lib/useTheme";
import { useAssistantTurn } from "../lib/useAssistantTurn";
import { useThread } from "../lib/useThread";
import { AboutModal } from "./AboutModal";
import { AssistantPanel } from "./AssistantPanel";
import { AreaSelectionCard } from "./AreaSelectionCard";
import { BottomSheet } from "./BottomSheet";
import { ClearPinsDialog } from "./ClearPinsDialog";
import { ContextStrip } from "./ContextStrip";
import { DataFreshness } from "./DataFreshness";
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
import type { AnalysisCardData, AnalysisSettings, AreaDrawMode, AreaPolygonGeometry, AssistantDashboardState, BadgeDescriptor, BeatFeatureCollection, GeocodeResult, LatLng, LayerKey, MapBounds, Place, PlaceCreate } from "../types";

const ANALYSIS_SETTING_KEYS: (keyof AnalysisSettings)[] = [
  "startDate",
  "endDate",
  "radiusM",
  "offenseCategory",
  "layer",
];

function changedAnalysisFields(
  current: AnalysisSettings,
  patch: Partial<AnalysisSettings>,
): (keyof AnalysisSettings)[] {
  return ANALYSIS_SETTING_KEYS.filter(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  );
}

function previousAnalysisSettings(
  current: AnalysisSettings,
  fields: (keyof AnalysisSettings)[],
): Partial<AnalysisSettings> {
  const previous: Partial<AnalysisSettings> = {};
  for (const field of fields) {
    Object.assign(previous, { [field]: current[field] });
  }
  return previous;
}

function assistantSettingsReceipt(
  current: AnalysisSettings,
  patch: Partial<AnalysisSettings>,
  fields: (keyof AnalysisSettings)[],
): string {
  const next = { ...current, ...patch };
  if (fields.length === 1 && fields[0] === "radiusM") {
    return `Tabby changed the radius from ${current.radiusM} m to ${next.radiusM} m.`;
  }
  if (fields.every((field) => field === "startDate" || field === "endDate")) {
    return `Tabby changed the date range to ${next.startDate} – ${next.endDate}.`;
  }
  if (fields.length === 1 && fields[0] === "offenseCategory") {
    return `Tabby changed the category to ${categoryLabel(next.offenseCategory, next.layer)}.`;
  }
  if (fields.length === 1 && fields[0] === "layer") {
    return `Tabby changed the layer to ${incidentNoun(next.layer).plural}.`;
  }
  const labels = Array.from(new Set(fields.map((field) => {
    if (field === "startDate" || field === "endDate") return "date range";
    if (field === "radiusM") return "radius";
    if (field === "offenseCategory") return "category";
    return "layer";
  })));
  const joined = labels.length === 2
    ? labels.join(" and ")
    : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
  return `Tabby updated the ${joined}.`;
}

function pointsForCard(card: AnalysisCardData, places: Place[]): LatLng[] {
  if (card.points?.length) {
    return card.points.map((point) => ({ lat: point.latitude, lng: point.longitude }));
  }
  return card.placeIds
    .map((id) => places.find((place) => place.id === id))
    .filter((place): place is Place => Boolean(place && place.latitude != null && place.longitude != null))
    .map((place) => ({ lat: place.latitude as number, lng: place.longitude as number }));
}

export function MapWorkspace() {
  const { theme, setTheme } = useTheme();
  const initialView = useMemo(() => {
    const param = new URLSearchParams(window.location.search).get("view");
    return param ? decodeView(param) : null;
  }, []);
  const hadViewParam = useMemo(() => Boolean(new URLSearchParams(window.location.search).get("view")), []);
  const [sharedBanner, setSharedBanner] = useState(Boolean(initialView));
  const [showBadLink, setShowBadLink] = useState(hadViewParam && initialView === null);

  const thread = useThread();
  // A deterministic post-add offer ("Saved X. Want me to pull what's on file nearby?") with
  // command chips. Set only by a user-driven place add (pin/manual/import) with no auto-run
  // armed; consumed by any chip use, a chat send, a command chip, or a context invalidation.
  const [offer, setOffer] = useState<{ text: string; chips: FollowupChip[] } | null>(null);
  const [chipFlyTo, setChipFlyTo] = useState<LatLng | null>(null);
  const [managePlaces, setManagePlaces] = useState<ManageView | null>(null);
  const [clearPinsOpen, setClearPinsOpen] = useState(false);
  const [clearingPins, setClearingPins] = useState(false);
  const [clearPinsError, setClearPinsError] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [savingEntryKey, setSavingEntryKey] = useState<string | null>(null);
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
  const [assistantUpdatedFields, setAssistantUpdatedFields] = useState<(keyof AnalysisSettings)[]>([]);
  const assistantUpdateTimerRef = useRef<number | null>(null);
  const assistantReceiptSequenceRef = useRef(0);
  const analysisEditedRef = useRef(Boolean(initialView));
  const [beats, setBeats] = useState<BeatFeatureCollection | null>(null);
  const [viewport, setViewport] = useState<MapBounds | null>(null);
  const [areaGeometry, setAreaGeometry] = useState<AreaPolygonGeometry | null>(null);
  const [areaDrawMode, setAreaDrawMode] = useState<AreaDrawMode | null>(null);
  const [areaInspectorOpen, setAreaInspectorOpen] = useState(false);

  const data = useDashboardData();

  useEffect(() => () => {
    if (assistantUpdateTimerRef.current !== null) {
      window.clearTimeout(assistantUpdateTimerRef.current);
    }
  }, []);
  const clearablePlaces = useMemo(
    () => data.places.filter((place) => place.inferred_place_type === "manual_place"),
    [data.places],
  );
  useEffect(() => {
    if (!data.sessionReady) return;
    getBeatPolygons().then(setBeats).catch(() => setBeats(null)); // outline layer is optional chrome
  }, [data.sessionReady]);
  const layerAvailability = useMemo<Partial<Record<LayerKey, boolean>> | undefined>(() => {
    if (!data.freshness) return undefined;
    return {
      reported: Boolean(data.freshness.reported?.data_through),
      arrests: Boolean(data.freshness.arrests?.data_through),
      calls: Boolean(data.freshness.calls?.data_through),
    };
  }, [data.freshness]);
  const activeLayerAvailable = layerAvailability?.[analysis.layer] !== false;
  const incidentLayer = useIncidentPoints({ bounds: viewport, analysis, enabled: activeLayerAvailable });
  const areaSelection = useAreaSelection({
    geometry: areaGeometry,
    analysis,
    enabled: activeLayerAvailable,
  });

  // The freshness request resolves after initial render. Before an untouched returning
  // session auto-runs, move its default window onto the latest calendar year that actually
  // has rows. Share links and any user edit keep their explicit dates.
  useEffect(() => {
    if (initialView || analysisEditedRef.current || !data.freshnessLoaded) return;
    analysisEditedRef.current = true;
    const available = data.freshness?.reported
      ? availableDataAnalysisWindow(data.freshness.reported)
      : null;
    if (!available) return;
    setAnalysis((current) => ({
      ...current,
      startDate: available.analysis_start_date,
      endDate: available.analysis_end_date,
    }));
  }, [data.freshness, data.freshnessLoaded, initialView]);
  const { selectedIds, setSelectedIds, restored } = usePersistedSelection(data.places);
  const [pendingAutoRun, setPendingAutoRun] = useState(false);
  // Recomputed every render: useDrawer's window-resize listener always produces a new
  // drawer object, so viewport changes re-render. No extra state needed.
  const isMobile = isMobileViewport(window.innerWidth);
  const isCompactDesktop = isCompactDesktopViewport(window.innerWidth);
  const { drawer, setCollapsed: setDrawerCollapsed, onResize: onDrawerResize, onToggleCollapsed, onPreset, onSnap } = useDrawer();
  // Which thread card is expanded (by object identity — the thread cap shifts indices but
  // card references survive), plus the drawer width to restore when it collapses (null
  // means the drawer was collapsed/peeked when we widened, so there's nothing to restore).
  const [expandedCard, setExpandedCard] = useState<AnalysisCardData | null>(null);
  const [currentCard, setCurrentCard] = useState<AnalysisCardData | null>(null);
  const prevWidthRef = useRef<number | null>(null);
  const localCardRef = useRef<AnalysisCardData | null>(null);
  // Camera fits use the card's frozen scope, including ad-hoc points that do not exist in
  // dashboard data. MapCanvas's fitBounds naturally zooms close groups in and frames spread-
  // out groups more broadly; asymmetric padding keeps every location clear of the panel.
  const [fitTo, setFitTo] = useState<{ points: LatLng[]; padding: { top: number; right: number; bottom: number; left: number } } | null>(null);
  const fitCard = useCallback(
    (card: AnalysisCardData, desktopPanelWidth = drawer.collapsed ? DRAWER_RAIL : drawer.widthPx) => {
      const points = pointsForCard(card, data.places);
      if (points.length === 0) return;
      const rightInset = isMobile ? 40 : desktopPanelWidth + 40;
      const bottomInset = isMobile
        ? snapHeightPx(drawer.snap === "bar" ? "bar" : "half", window.innerHeight)
        : 40;
      setFitTo({ points, padding: { top: 90, left: 40, right: rightInset, bottom: bottomInset } });
    },
    [data.places, drawer.collapsed, drawer.snap, drawer.widthPx, isMobile],
  );
  const expandCard = useCallback(
    (card: AnalysisCardData) => {
      if (prevWidthRef.current === null) prevWidthRef.current = drawer.collapsed ? null : drawer.widthPx;
      setExpandedCard(card);
      if (!isMobile) {
        const detailWidth = Math.max(drawer.widthPx, clampWidth(DRAWER_DETAIL));
        onDrawerResize(detailWidth);
        fitCard(card, detailWidth);
      } else {
        onSnap("full");
      }
    },
    [drawer.collapsed, drawer.widthPx, fitCard, isMobile, onDrawerResize, onSnap],
  );

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

  // One identity source for cards AND pins: index within the list. Saved entries key by
  // place id; ad-hoc entries key by coordinate key — the same synthetic id their map pins
  // and hover events use.
  const identityByPlaceId = useMemo(
    () =>
      new Map<string, PlaceIdentity>(
        list.entries.map((entry, index) => [entry.savedPlaceId ?? keyOf(entry), placeIdentity(index)] as const),
      ),
    [list.entries],
  );
  const savedIdSet = useMemo(
    () => new Set(list.entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id))),
    [list.entries],
  );
  // Ad-hoc entries get map pins too: Place-shaped synthetics keyed by coordinate key.
  // They render as "selected" pins (letter + label tag); rings/badges need persisted
  // summaries, which only saved places have.
  const adhocPlaces = useMemo(
    () =>
      list.entries
        .filter((entry) => !entry.savedPlaceId)
        .map((entry) => ({
          id: keyOf(entry),
          display_label: entry.label,
          latitude: entry.latitude,
          longitude: entry.longitude,
          visit_count: 0,
          total_dwell_minutes: null,
          inferred_place_type: "adhoc_entry",
          sensitivity_class: "normal",
        })),
    [list.entries],
  );
  const mapPlaces = useMemo(() => [...data.places, ...adhocPlaces], [data.places, adhocPlaces]);
  const pinIdSet = useMemo(
    () => new Set([...savedIdSet, ...adhocPlaces.map((p) => p.id)]),
    [savedIdSet, adhocPlaces],
  );
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const [dismissedIncidentErrorId, setDismissedIncidentErrorId] = useState(0);
  // The full map key is useful reference material but noisy as standing chrome, so every
  // viewport keeps it behind a compact toggle (focus mode hides the toggle too).
  const [mapKeyOpen, setMapKeyOpen] = useState(false);
  const mapKeyToggleRef = useRef<HTMLButtonElement>(null);

  const compare = useCompare({
    entries: list.entries,
    analysis,
    setError: data.setError,
    onSummariesRefreshed: () => void data.refreshWithFallback("Ran, but dashboard totals could not refresh."),
  });

  // Presence badges for places with current (not-yet-invalidated) analysis results —
  // replaced wholesale per analysis, cleared whenever the analysis context invalidates.
  const [liveBadges, setLiveBadges] = useState<Map<string, BadgeDescriptor>>(new Map());
  // Memoized like pinIdSet/identityByPlaceId above: MapCanvas rebuilds markers (and
  // restarts pin-drop animations) whenever this Set's identity changes, so it must stay
  // stable across renders where liveBadges itself hasn't changed.
  const badgedPlaceIds = useMemo(() => new Set(liveBadges.keys()), [liveBadges]);
  // A badge tap asks the rail to scroll to that place's newest card; wrapped in a fresh
  // object per tap so re-tapping the same badge re-fires the panel's scroll effect.
  const [focusCard, setFocusCard] = useState<{ card: AnalysisCardData } | null>(null);
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

  // The shared view is now in component state, so the ?view= blob has done its job. Strip it
  // (replaceState, so no history entry and no reload) — otherwise a reload or a bookmark
  // silently re-applies the shared scope over whatever the user has since built, and the
  // address bar keeps advertising someone else's link. The Exit affordance reads
  // `sharedBanner`, not the URL, so it keeps working.
  useEffect(() => {
    if (!hadViewParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [hadViewParam]);

  // "Analysis greets you": one shot after the persisted selection seeds the list. Share
  // links own their first run above; landing lookups arm pendingAutoRun themselves.
  const autoRunArmedRef = useRef(false);
  useEffect(() => {
    if (autoRunArmedRef.current || initialView || !restored || list.edited || !data.freshnessLoaded) return;
    if (list.entries.length > 0) {
      autoRunArmedRef.current = true;
      setPendingAutoRun(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, list.entries.length, data.freshnessLoaded]);

  // An armed auto-run (share link / lookup / restored session) lands its result as a local
  // card on the rail. Fully saved-place lists carry the AnalysisRun id from the parallel
  // summary refresh and can export; ad-hoc or mixed point lists remain runId-null.
  const pendingCardRef = useRef(false);
  useEffect(() => {
    if (!pendingAutoRun || list.entries.length === 0) return;
    if (!data.freshnessLoaded) return;
    if (!activeLayerAvailable) {
      setPendingAutoRun(false);
      data.setError("That data layer is not loaded yet. Choose an available layer to run analysis.");
      return;
    }
    setPendingAutoRun(false);
    pendingCardRef.current = true;
    void compare.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoRun, list.entries, activeLayerAvailable, data.freshnessLoaded]);

  // Freeze the canonical report into the thread. The legacy slices stay attached only as a
  // compatibility fallback for cards produced before this migration; the report renderer and
  // every new export read `report` exclusively.
  useEffect(() => {
    if (!pendingCardRef.current || !compare.report) return;
    const savedPlaceIds = list.entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
    const card: AnalysisCardData = {
      kind: compare.report.selection_kind === "multi_place" ? "compare" : "analyze",
      placeIds: savedPlaceIds,
      points: savedPlaceIds.length === list.entries.length
        ? undefined
        : list.entries.map(({ latitude, longitude, label }) => ({ latitude, longitude, label })),
      runId: compare.analysisRunId,
      settings: {
        radius_m: compare.report.scope.radius_m,
        analysis_start_date: compare.report.scope.effective_start_date,
        analysis_end_date: compare.report.scope.effective_end_date,
        offense_category: compare.report.scope.filters.offense_category,
        offense_subcategory: compare.report.scope.filters.offense_subcategory
          ?? compare.report.scope.filters.arrest_offense_description
          ?? compare.report.scope.filters.call_type,
        nibrs_group: compare.report.scope.filters.nibrs_group,
        layer: compare.report.scope.layer,
      },
      comparison: compare.comparison,
      neighborhood: compare.neighborhood,
      incidents: compare.incidents,
      report: compare.report,
    };
    pendingCardRef.current = false;
    thread.replaceAnalysisCard(localCardRef.current, card);
    localCardRef.current = card;
    setCurrentCard(card);
    // A completed report now hands the rail to report-aware conversation. Keep the report
    // collapsed as a readable reference; View report still opens the full document on demand.
    fitCard(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare.report]);

  function invalidateAnalysisContext() {
    // Any context invalidation cancels a pending auto-run card: if the armed run failed
    // (ref left armed), a later result landing in the same slices must not revive it.
    pendingCardRef.current = false;
    compare.invalidate();
    // Filter/selection changes detach presence badges — they describe a specific run's
    // results, which no longer reflect the current context once it changes.
    setLiveBadges(new Map());
    setCurrentCard(null);
    // A stale offer references the pre-change window/selection — drop it. selectPlaceIds
    // re-sets the offer AFTER this call (batched, last write wins), so its own add survives.
    setOffer(null);
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
    if (resolved.length > 0) {
      // Run results are keyed to the list, so a late append makes them stale;
      // assistant-applied panes (runPoints === null) are decoupled and must survive.
      if (compare.runPoints !== null) invalidateAnalysisContext();
      resolved.forEach((entry) => list.add(entry));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.places]);

  function selectPlaceIds(ids: string[], savedPlaces?: SavedPlaceRef[]) {
    if (ids.length === 0) return;
    invalidateAnalysisContext();
    // A just-saved place whose coordinates match an existing ad-hoc entry links in place
    // (markSaved — mirroring the retired Compare row-save) instead of dedup-adding, which
    // would keep the entry ad-hoc and leave the saved place looking unselected. Coords are
    // preserved exactly so saving never shifts the analysis point.
    const linked = new Set<string>();
    for (const place of savedPlaces ?? []) {
      if (place.latitude == null || place.longitude == null) continue;
      const key = keyOf({ latitude: place.latitude, longitude: place.longitude });
      if (list.entries.some((e) => !e.savedPlaceId && keyOf(e) === key)) {
        list.markSaved(key, place.id);
        linked.add(place.id);
      }
    }
    entriesForIds(ids.filter((id) => !linked.has(id))).forEach((entry) => list.add(entry));
    // A user-driven add earns a deterministic offer ("pull the reports near this?"), but only
    // when no auto-run is armed — the audit codified: share/restore/lookup paths never pass
    // savedPlaces (and never call selectPlaceIds at all), so this guard is belt-and-braces.
    // Set AFTER invalidateAnalysisContext's setOffer(null) above so this add's offer survives
    // (both are batched; the later write wins). savedIdSet lags a render, so add the new count.
    const built =
      savedPlaces?.length && !pendingAutoRun
        ? offerForPlaces(savedPlaces, analysis, savedIdSet.size + savedPlaces.length)
        : null;
    if (built) {
      thread.append({ kind: "tabby_text", text: built.text });
      setOffer(built);
      // The proactive moment must be SEEN when it fires: raise a collapsed drawer/sheet so
      // the offer is on screen (mobile sheet included).
      if (isMobile) onSnap("half");
      else setDrawerCollapsed(false);
    }
  }

  const pinDraft = usePinDraft({
    selectPlaceIds,
    refreshWithFallback: data.refreshWithFallback,
    // usePinDraft stays boolean-only; translate to a snap on mobile (armed → bar, placed → half).
    setDrawerCollapsed: (collapsed) => {
      if (isMobile) onSnap(collapsed ? "bar" : "half");
      else setDrawerCollapsed(collapsed);
    },
  });

  function startAreaDraw(mode: AreaDrawMode) {
    pinDraft.setAddPinMode(false);
    setAreaDrawMode(mode);
    setAreaInspectorOpen(false);
    if (isMobile) onSnap("bar");
  }

  function completeAreaDraw(geometry: AreaPolygonGeometry) {
    setAreaGeometry(geometry);
    setAreaDrawMode(null);
    setAreaInspectorOpen(true);
    if (isMobile) onSnap("half");
    else setDrawerCollapsed(false);
  }

  function clearAreaSelection() {
    setAreaGeometry(null);
    setAreaDrawMode(null);
    setAreaInspectorOpen(false);
  }

  // A newer search/preview target supersedes the last chip fly; chip clicks leave
  // pinDraft.flyTo untouched so this never fires for them.
  useEffect(() => {
    setChipFlyTo(null);
  }, [pinDraft.flyTo]);

  function handleLookup(result: GeocodeResult) {
    pinDraft.previewSearch(result);
    invalidateAnalysisContext();
    setPendingAutoRun(false);
    setSharedBanner(false);
    list.replaceAll([{ latitude: result.latitude, longitude: result.longitude, label: compactGeocodeLabel(result.label) }]);
  }

  function handleToggleSelect(id: string) {
    const place = data.places.find((p) => p.id === id);
    if (place) {
      invalidateAnalysisContext();
      pinDraft.setDraft(null);
      setSharedBanner(false);
      list.toggleSaved(place);
      return;
    }
    const adhocIndex = list.entries.findIndex((e) => !e.savedPlaceId && keyOf(e) === id);
    if (adhocIndex >= 0) {
      // Focus, not destroy: the row's labeled ✕ owns removal for ad-hoc entries.
      const entry = list.entries[adhocIndex];
      setChipFlyTo({ lat: entry.latitude, lng: entry.longitude });
    }
  }

  function handleFocusEntry(entry: AddressEntry) {
    setChipFlyTo({ lat: entry.latitude, lng: entry.longitude });
  }

  function handleRemoveEntry(index: number) {
    const entry = list.entries[index];
    if (!entry) return;
    invalidateAnalysisContext();
    if (entry.savedPlaceId) {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(entry.savedPlaceId as string);
        return next;
      });
    }
    if (pinDraft.draft && keyOf(pinDraft.draft) === keyOf(entry)) {
      pinDraft.setDraft(null);
    }
    list.removeAt(index);
  }

  async function handleSaveEntry(entry: AddressEntry) {
    if (entry.savedPlaceId) return;
    const entryKey = keyOf(entry);
    setSavingEntryKey(entryKey);
    data.setError("");
    try {
      const created = await createPlace({
        display_label: entry.label,
        latitude: entry.latitude,
        longitude: entry.longitude,
        // ManualPlaceCreate requires ge=1; 0 made every save of a searched address a 422.
        visit_count: 1,
        sensitivity_class: "normal",
      });
      list.markSaved(entryKey, created.id);
      setSelectedIds((current) => new Set([...current, created.id]));
      const currentLocalCard = localCardRef.current;
      if (currentLocalCard && currentCard === currentLocalCard) {
        const reconciledCard = cardWithSavedPlaceIds(
          currentLocalCard,
          list.entries.map((candidate) =>
            keyOf(candidate) === entryKey ? created.id : candidate.savedPlaceId
          ),
        );
        if (reconciledCard !== currentLocalCard) {
          thread.replaceAnalysisCard(currentLocalCard, reconciledCard);
          localCardRef.current = reconciledCard;
          setCurrentCard(reconciledCard);
        }
      }
      await data.refreshWithFallback("Saved, but dashboard places could not refresh.");
    } catch (cause) {
      data.setError(friendlyMessageOr(cause, "Unable to save this place. Try again."));
    } finally {
      setSavingEntryKey(null);
    }
  }

  function handleAnalysisChange(patch: Partial<AnalysisSettings>) {
    if (patch.layer && layerAvailability?.[patch.layer] === false) {
      data.setError("That data layer is not loaded yet.");
      return;
    }
    analysisEditedRef.current = true;
    setAssistantUpdatedFields([]);
    invalidateAnalysisContext();
    setAnalysis((current) => ({ ...current, ...patch }));
  }

  async function handleDelete(id: string) {
    data.setError("");
    invalidateAnalysisContext(); // also clears ALL live badges — delete invalidates the whole analysis context
    try {
      await deletePlace(id);
      const entryIndex = list.entries.findIndex((e) => e.savedPlaceId === id);
      if (entryIndex >= 0) list.removeAt(entryIndex);
      setSelectedIds((current) => { const next = new Set(current); next.delete(id); return next; });
      await data.refreshWithFallback("Removed place, but dashboard totals could not refresh.");
    } catch (cause) {
      data.setError(friendlyMessageOr(cause, "Unable to remove place. Try again."));
    }
  }

  function requestClearPins() {
    setClearPinsError("");
    setClearPinsOpen(true);
  }

  async function handleClearPins() {
    if (clearingPins) return;
    const clearableIds = new Set(clearablePlaces.map((place) => place.id));
    setClearingPins(true);
    setClearPinsError("");
    data.setError("");
    try {
      if (clearableIds.size > 0) await deleteAllPlaces();
      clearRecentPlaces();
      invalidateAnalysisContext();
      pendingIdsRef.current = [];
      pinDraft.setDraft(null);
      pinDraft.setAddPinMode(false);
      setSharedBanner(false);
      list.replaceAll(
        list.entries.filter((entry) => entry.savedPlaceId && !clearableIds.has(entry.savedPlaceId)),
      );
      setSelectedIds((current) => new Set(Array.from(current).filter((id) => !clearableIds.has(id))));
      if (clearableIds.size > 0) {
        await data.refreshWithFallback("Cleared pins, but dashboard totals could not refresh.");
      }
      setClearPinsOpen(false);
    } catch (cause) {
      const message = friendlyMessageOr(cause, "Unable to clear pins. Try again.");
      setClearPinsError(message);
      data.setError(message);
    } finally {
      setClearingPins(false);
    }
  }

  async function handleManualSubmit(place: PlaceCreate) {
    data.setError("");
    const created = await createPlace(place);
    selectPlaceIds([created.id], [created]);
    await data.refreshWithFallback("Saved, but dashboard totals could not refresh.");
  }

  async function handleImport(csv: string) {
    data.setError("");
    const result = await createBulkPlaces(csv);
    selectPlaceIds(result.places.map((place) => place.id), result.places);
    await data.refreshWithFallback("Imported rows, but dashboard totals could not refresh.");
  }

  function applyAssistantToolResult(payload: { tool_name?: string; result?: unknown }) {
    const effect = interpretToolResult(payload);
    if (!effect) return;
    // Assistant results supersede any pending auto-run card. Without this, a failed auto-run
    // leaves the ref armed, and applyAssistant writing the same result slices the completion
    // effect keys on would append a LOCAL card alongside the bridge card (double-card).
    pendingCardRef.current = false;
    if (effect.selection || effect.neighborhood !== undefined || effect.incidents !== undefined || effect.comparison !== undefined) {
      pinDraft.setDraft(null);
      setSharedBanner(false);
    }
    if (effect.settings) {
      const changedFields = changedAnalysisFields(analysis, effect.settings);
      if (changedFields.length > 0) {
        const previous = previousAnalysisSettings(analysis, changedFields);
        const receiptId = `filter-${++assistantReceiptSequenceRef.current}`;
        thread.append({
          kind: "receipt",
          text: assistantSettingsReceipt(analysis, effect.settings, changedFields),
          undo: { id: receiptId, settings: previous },
        });
        setAssistantUpdatedFields(changedFields);
        if (assistantUpdateTimerRef.current !== null) {
          window.clearTimeout(assistantUpdateTimerRef.current);
        }
        assistantUpdateTimerRef.current = window.setTimeout(
          () => setAssistantUpdatedFields([]),
          2400,
        );
      }
      analysisEditedRef.current = true;
      setAnalysis((current) => ({ ...current, ...effect.settings }));
      // Assistant filter changes detach results like user edits do; analyze/compare
      // effects re-apply panes and badges right below.
      invalidateAnalysisContext();
    }
    // Assistant selection edits invalidate like user edits; payload-bearing effects
    // re-apply their panes right below.
    if (effect.selection) invalidateAnalysisContext();
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
    // The newest analysis defines "current" — badges replace wholesale, not merge.
    if (effect.badges) setLiveBadges(new Map(effect.badges.map((b) => [b.place_id, b])));
    // The frozen card lands in the thread alongside the map effects — it doesn't replace them.
    // Canonical reports are the requested result, so open them at the heading instead of
    // hiding their reference, type, temporal, and record sections behind another click.
    // Legacy cards remain compact because their older detail layout is supplemental.
    if (effect.card) {
      const card = effect.card;
      thread.append({ kind: "analysis_card", card });
      setCurrentCard(card);
      if (card.report) {
        if (isMobile) fitCard(card);
        expandCard(card);
        setFocusCard({ card });
      } else {
        fitCard(card);
      }
    }
  }

  // Tapping a pin's presence badge scrolls the rail to that place's newest analysis card
  // (reverse scan — the latest run defines "current"). A peeked/collapsed drawer opens so
  // the card is readable.
  function handleBadgeClick(placeId: string) {
    for (let i = thread.items.length - 1; i >= 0; i--) {
      const item = thread.items[i];
      if (item.kind === "analysis_card" && item.card.placeIds.includes(placeId)) {
        if (drawer.collapsed) {
          if (isMobile) onSnap("half");
          else setDrawerCollapsed(false);
        }
        setFocusCard({ card: item.card });
        return;
      }
    }
  }

  const buildShareUrl = useCallback((): string | null => {
    const points = list.entries.map((e) => ({ latitude: e.latitude, longitude: e.longitude, label: e.label }));
    if (points.length === 0) return null;
    const encoded = encodeView({
      points, radiusM: analysis.radiusM,
      startDate: analysis.startDate, endDate: analysis.endDate,
      layer: analysis.layer, offenseCategory: analysis.offenseCategory,
    });
    return `${window.location.origin}/?view=${encoded}`;
  }, [list, analysis]);

  // Copies the share link, reporting success/failure to the strip's transient status note.
  const handleCopyLink = useCallback(async (): Promise<boolean> => {
    const url = buildShareUrl();
    if (!url) return false;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, [buildShareUrl]);

  // The manage-places dialog owns per-place export privacy toggles; keep mutation and summary
  // refresh centralized here with the rest of the workspace coordination.
  async function handleToggleExport(id: string, include: boolean) {
    data.setError("");
    try {
      await updatePlace(id, { sensitivity_class: include ? "normal" : "suppress_from_public_export" });
      await data.refreshWithFallback("Updated export setting, but dashboard totals could not refresh.");
    } catch {
      data.setError("Unable to update export setting. Try again.");
    }
  }

  const assistantState: AssistantDashboardState = useMemo(() => {
    const hasAdhocEntry = list.entries.some((entry) => !entry.savedPlaceId);
    return {
      // A mixed list must use one selection source. Inline points preserve every pin in
      // order and remain transient; all-saved lists keep the owned-id path and its exports.
      selected_place_ids: hasAdhocEntry ? [] : Array.from(savedIdSet),
      selected_points: hasAdhocEntry
        ? list.entries.map(({ latitude, longitude, label }) => ({ latitude, longitude, label }))
        : [],
      analysis_start_date: analysis.startDate || null,
      analysis_end_date: analysis.endDate || null,
      radii_m: [analysis.radiusM],
      offense_category: analysis.offenseCategory || null,
      offense_subcategory: null,
      nibrs_group: null,
      layer: analysis.layer,
    };
  }, [analysis, list.entries, savedIdSet]);

  // Turn machinery lives here, not in AssistantPanel: the shared busy/draft/offline state
  // must survive the panel unmounting.
  const turn = useAssistantTurn({
    dashboardState: assistantState,
    items: thread.items,
    append: thread.append,
    onToolResult: applyAssistantToolResult,
  });

  // Slice-2 commands carry explicit args (no LLM to fill them from context): the two
  // analysis chips send the saved-place ids plus the dashboard's current window —
  // without dates and a radius the tools clarify instead of running.
  function runPanelCommand(label: string, command: AssistantCommandName) {
    if (!activeLayerAvailable) {
      data.setError("That data layer is not loaded yet.");
      return;
    }
    setOffer(null); // a command chip supersedes any pending place-added offer
    const args: Record<string, unknown> = {};
    if (command === "analyze_places" || command === "compare_places") {
      args.place_ids = Array.from(savedIdSet);
      args.analysis_start_date = analysis.startDate || null;
      args.analysis_end_date = analysis.endDate || null;
      args.layer = analysis.layer;
      if (analysis.offenseCategory) args.offense_category = analysis.offenseCategory;
      // analyze_places takes the list form; compare_places a single radius.
      if (command === "analyze_places") args.radii_m = [analysis.radiusM];
      else args.radius_m = analysis.radiusM;
    }
    void turn.runCommand(label, command, args);
  }

  // The direct report action lives in Tabby's composer but bypasses the assistant command stream.
  // useCompare calls the public dashboard endpoints for saved and ad-hoc places alike, then
  // the completion effect freezes the returned slices into the same rich result card.
  function handleDirectReportRun() {
    if (!activeLayerAvailable || list.entries.length === 0) return;
    setOffer(null);
    pendingCardRef.current = true;
    void compare.run();
  }

  // Tabby's onboarding chips route through these place actions.
  function handlePanelAction(action: "search" | "add-pin" | "manual") {
    if (action === "search") document.getElementById("mc-search-input")?.focus();
    else if (action === "add-pin") pinDraft.startAddPin();
    else setManagePlaces("manual");
  }

  // Focus mode is a desktop side-panel concept — force it off on mobile (the bottom sheet).
  const isFocus = !isMobile && !drawer.collapsed && window.innerWidth - drawer.widthPx < FOCUS_CHROME_MIN;

  // The compact map-count pill is visible only at the peek snap, just above attribution.
  // The map key rides above the pill there, then follows the raised sheet when it moves to
  // half. At full there is no map left to key, so CSS hides it.
  const mapKeyBottomPx = Math.max(
    snapHeightPx(drawer.snap === "full" ? "half" : drawer.snap, window.innerHeight) + 12,
    220,
  );

  // The open map key is a dismissible overlay, so Escape closes it and hands focus back to
  // the toggle that opened it.
  useEffect(() => {
    if (!mapKeyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMapKeyOpen(false);
      mapKeyToggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mapKeyOpen]);

  // Follow-up chips key off the newest card's OWN frozen scope, so they re-run against what
  // the card shows even after the live dashboard has moved on.
  const latestCard: AnalysisCardData | null = useMemo(() => {
    for (let i = thread.items.length - 1; i >= 0; i--) {
      const item = thread.items[i];
      if (item.kind === "analysis_card") return item.card;
    }
    return null;
  }, [thread.items]);
  const followupChips = useMemo(
    // Saved-id and transient-point cards both carry a complete frozen rerun scope.
    () =>
      latestCard && (latestCard.placeIds.length > 0 || (latestCard.points?.length ?? 0) > 0)
        ? followupChipsFor(latestCard.kind, latestCard.settings, data.availableRadii)
        : [],
    [latestCard, data.availableRadii],
  );
  // A pending place-added offer owns the chip row until it's consumed; otherwise the newest
  // card's re-run chips show.
  const chipRow = (offer?.chips ?? followupChips).filter((chip) => {
    const targetLayer = chip.settingsPatch.layer;
    return !targetLayer || layerAvailability?.[targetLayer] !== false;
  });
  function handleFollowupChip(chip: FollowupChip) {
    setOffer(null); // any chip use consumes the offer
    if (chip.args) {
      // Offer chips carry a full-args override — run it verbatim, no card required. A
      // compare_places offer without place_ids compares the whole saved set.
      const args = { ...chip.args };
      // Union in ids still awaiting the summary refresh so a fast click after a
      // save still compares the place the offer is about.
      if (chip.command === "compare_places" && !args.place_ids) {
        args.place_ids = Array.from(new Set([...savedIdSet, ...pendingIdsRef.current]));
      }
      for (const key of Object.keys(args)) if (args[key] == null) delete args[key];
      void turn.runCommand(chip.label, chip.command, args);
      return;
    }
    if (!latestCard) return;
    void turn.runCommand(chip.label, chip.command, buildRerunArgs(latestCard, chip));
  }

  // Expanding a card widens the drawer to read the expanded view; collapsing restores the
  // prior width. useCallback so cards can be memoized later without churning this prop.
  const handleCardExpandChange = useCallback(
    (card: AnalysisCardData, expanded: boolean) => {
      if (expanded) {
        expandCard(card);
      } else {
        setExpandedCard(null);
        if (!isMobile && prevWidthRef.current !== null) onDrawerResize(prevWidthRef.current);
        else if (isMobile) onSnap("half");
        prevWidthRef.current = null;
      }
    },
    [expandCard, isMobile, onSnap, onDrawerResize],
  );

  // Analysis cards export the current detail-view schema. The Manage Places footer keeps the
  // separate session-wide place-summary download.
  const exportHrefBase = data.analysisExportHref.split("?")[0];

  // Below the breakpoint the panel is a bottom sheet and the layer controls live inside it.
  const freshnessIndicator = (
    <DataFreshness freshness={data.freshness} layer={analysis.layer} loaded={data.freshnessLoaded} />
  );
  const layerControls = (
    <>
      <LayerToggle layer={analysis.layer} availability={layerAvailability} counts={incidentLayer.layerTotals} onChange={(layer) => handleAnalysisChange({ layer, offenseCategory: "" })} />
      {!isMobile ? freshnessIndicator : null}
    </>
  );
  const paneIsWide = drawer.widthPx >= clampWidth(DRAWER_WIDE);
  const paneActions = !isMobile ? (
    <div className="mc-pane-actions">
      <button
        type="button"
        className="mc-pane-action"
        aria-label={paneIsWide ? "Use default pane width" : "Use wide pane width"}
        aria-pressed={paneIsWide}
        title={paneIsWide ? "Use default pane width" : "Use wide pane width"}
        onClick={() => onPreset(paneIsWide ? "default" : "wide")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 8 4 12l4 4M16 8l4 4-4 4M4 12h16" />
        </svg>
        <span>{paneIsWide ? "Standard" : "Widen"}</span>
      </button>
      <button type="button" className="mc-pane-action" aria-label="Collapse Tabby pane" title="Collapse Tabby pane" onClick={onToggleCollapsed}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span>Hide</span>
      </button>
    </div>
  ) : null;

  const locationControls = (
    <PlaceChipStrip
      places={data.places}
      entries={list.entries}
      identityByPlaceId={identityByPlaceId}
      savingKey={savingEntryKey}
      saveHiddenKey={pinDraft.draft ? keyOf(pinDraft.draft) : null}
      onToggle={handleToggleSelect}
      onFocus={handleFocusEntry}
      onHoverPlace={setHoveredPlaceId}
      onRemove={handleRemoveEntry}
      onSave={(entry) => void handleSaveEntry(entry)}
      onAdd={() => setManagePlaces("manage")}
    />
  );

  const draftEditor = pinDraft.draft ? (
    <PinDraftPopover
      draft={pinDraft.draft}
      saving={pinDraft.draftSaving}
      error={pinDraft.draftError}
      autoFocus={!isMobile}
      onChange={(patch) => pinDraft.setDraft((current) => (current ? { ...current, ...patch } : current))}
      onSave={pinDraft.saveDraft}
      onCancel={() => pinDraft.setDraft(null)}
    />
  ) : null;

  return (
    <div className="mc-scope">
      <div
        className={`mc-frame${pinDraft.addPinMode ? " is-placing-pin" : ""}${isFocus ? " is-focus" : ""}${isCompactDesktop ? " is-compact-desktop" : ""}${isMobile ? ` is-sheet-${drawer.snap}` : ""}`}
        style={{ "--panel-width": `${drawer.collapsed ? DRAWER_RAIL : drawer.widthPx}px` } as CSSProperties}
      >
        <main aria-label="Map and reported incident context">
          <header className="mc-topbar">
          {/* The wordmark is a styled span, so the page had no h1 for screen readers or
              document outline. */}
          <h1 className="mc-sr">CompCat — reported Seattle incident context around addresses</h1>
          <div className="mc-brand">
            <span className="mc-logo">
              <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 9 L4 4 L9 7 Q12 6 15 7 L20 4 L20 9 Q21.5 11.5 21.5 14 Q21.5 20 12 20 Q2.5 20 2.5 14 Q2.5 11.5 4 9 Z" fill="var(--on-accent)" /><circle cx="8.5" cy="13" r="1.3" fill="var(--accent)" /><circle cx="15.5" cy="13" r="1.3" fill="var(--accent)" /></svg>
            </span>
            <span className="mc-wordmark">CompCat</span>
          </div>
          <div className="mc-topbar-right">
            {!isMobile && !isCompactDesktop ? layerControls : null}
            {!isMobile && !isCompactDesktop ? <div className="mc-status"><span className="dot" />Public session - Seattle</div> : null}
            <button
              type="button"
              className="mc-aboutbtn"
              aria-label="About CompCat"
              title="About CompCat"
              onClick={() => setAboutOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6h.01" /></svg>
            </button>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
          </header>

          <SearchPill
          search={(query, signal) => geocodingProvider.search(query, signal)}
          onSelect={handleLookup}
          addPinMode={pinDraft.addPinMode}
          onToggleAddPin={() => (pinDraft.addPinMode ? pinDraft.setAddPinMode(false) : pinDraft.startAddPin())}
          canClearPins={clearablePlaces.length > 0 || adhocPlaces.length > 0 || Boolean(pinDraft.draft)}
          onClearPins={requestClearPins}
          />
          <div className="mc-area-tools">
            <details>
              <summary>{areaGeometry ? "Redraw area" : "Select area"}</summary>
              <div>
                {(["rectangle", "polygon", "lasso"] as AreaDrawMode[]).map((mode) => (
                  <button key={mode} type="button" onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    startAreaDraw(mode);
                  }}>{mode[0].toUpperCase() + mode.slice(1)}</button>
                ))}
              </div>
            </details>
            {areaGeometry && !areaInspectorOpen ? <button type="button" onClick={() => { setAreaInspectorOpen(true); if (isMobile) onSnap("half"); else setDrawerCollapsed(false); }}>View area data</button> : null}
            {areaGeometry ? <button type="button" onClick={clearAreaSelection}>Clear area</button> : null}
          </div>
          {pinDraft.addPinMode ? (
            <div className="mc-helper" role="status"><span className="cross" />Click the map to drop a pin - Esc to cancel</div>
          ) : null}
          {areaDrawMode ? <div className="mc-helper" role="status"><span className="cross" />Draw a {areaDrawMode} area - Esc to cancel</div> : null}

          <MapCanvas
            places={mapPlaces}
            selectedIds={pinIdSet}
            draft={pinDraft.draft}
            addPinMode={pinDraft.addPinMode}
            summary={data.summary}
            analysis={analysis}
            flyTo={chipFlyTo ?? pinDraft.flyTo}
            beats={beats}
            highlightBeats={highlightBeats}
            incidentPoints={incidentLayer.geojson}
            areaGeometry={areaGeometry}
            areaHighlights={areaSelection.highlights}
            areaDrawMode={areaDrawMode}
            incidentNoun={incidentNoun(analysis.layer)}
            theme={theme}
            identityByPlaceId={identityByPlaceId}
            pulsePlaceId={hoveredPlaceId}
            badgedPlaceIds={badgedPlaceIds}
            fitTo={fitTo}
            onViewportChange={setViewport}
            onMapClick={areaDrawMode ? () => {} : pinDraft.handleMapClick}
            onMarkerClick={handleToggleSelect}
            onBadgeClick={handleBadgeClick}
            onAreaComplete={completeAreaDraw}
            onAreaCancel={() => setAreaDrawMode(null)}
            interactionDisabled={isMobile && drawer.snap === "full"}
          />

          {/* Keep the next step with the map action on desktop. In focus mode the map is
              only a locator strip, so the editor falls back to the roomy Tabby pane. */}
          {draftEditor && !isMobile && !isFocus ? (
            <div className="mc-draft-overlay">{draftEditor}</div>
          ) : null}

          <div className="mc-mapkey" style={{ "--mapkey-bottom": `calc(env(safe-area-inset-bottom) + ${mapKeyBottomPx}px)` } as CSSProperties}>
            <button
              type="button"
              ref={mapKeyToggleRef}
              className="mc-mapkey-toggle"
              aria-label="Map key"
              title="Map key"
              aria-expanded={mapKeyOpen}
              aria-controls="mc-map-legend"
              onClick={() => setMapKeyOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 7h.01M5 12h.01M5 17h.01M10 7h9M10 12h9M10 17h9" /></svg>
            </button>
            <MapLegend layer={analysis.layer} id="mc-map-legend" hidden={!mapKeyOpen} />
          </div>
          {!isMobile || drawer.snap === "bar" ? (
            <IncidentDisclosure
              returnedCount={incidentLayer.returnedCount}
              totalCount={incidentLayer.totalCount}
              returnedLocationCount={incidentLayer.returnedLocationCount}
              totalLocationCount={incidentLayer.totalLocationCount}
              unmappableCitywideCount={incidentLayer.unmappableCitywideCount}
              limit={incidentLayer.limit}
              itemNoun={incidentNoun(analysis.layer)}
              refreshing={incidentLayer.refreshing}
              stale={incidentLayer.stale}
            />
          ) : null}

          {data.error && data.places.length === 0 && list.entries.length === 0 && !pinDraft.draft ? (
          <p className="mc-error" role="alert">
            {data.error}{" "}
            {/* A dead session cannot be retried in place — only a reload mints a new one. */}
            {data.sessionFailed ? (
              data.error === SESSION_EXPIRED_MESSAGE ? (
                <button type="button" onClick={() => window.location.reload()}>Reload</button>
              ) : (
                <button type="button" onClick={data.retryBootstrap}>Retry</button>
              )
            ) : null}
          </p>
          ) : null}

        {/* The dot layer failed silently before: the map just showed no incidents, which
            reads as "nothing happened here" rather than "this did not load". */}
          {incidentLayer.error && dismissedIncidentErrorId !== incidentLayer.errorId ? (
          <div className="mc-banner mc-banner-warn" role="alert">
            {incidentLayer.error}{" "}
            <button type="button" onClick={() => setDismissedIncidentErrorId(incidentLayer.errorId)}>Dismiss</button>
          </div>
          ) : null}

          {sharedBanner ? (
          <div className="mc-banner" role="status">
            Shared view · reported incident context.{" "}
            <button
              type="button"
              onClick={() => {
                setSharedBanner(false);
                // Before the restore lands there is no saved selection to rebuild from —
                // keep the shared list; the user can edit it from here.
                if (!restored) return;
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
        </main>

        <BottomSheet
          collapsed={drawer.collapsed}
          widthPx={drawer.widthPx}
          onToggleCollapsed={onToggleCollapsed}
          onResize={onDrawerResize}
          isMobile={isMobile}
          snap={drawer.snap}
          onSnap={onSnap}
          peekHeader={isMobile ? layerControls : undefined}
        >
          <div className="mc-rail-wrap">
            {draftEditor && (isMobile || isFocus) ? (
              <div className="mc-draft-inline">{draftEditor}</div>
            ) : null}
            <AssistantPanel
              items={thread.items}
              busy={turn.busy}
              draft={turn.draft}
              statusLine={turn.statusLine}
              offline={turn.offline}
              onSend={(text) => { setOffer(null); void turn.sendChat(text); }}
              onRetry={() => void turn.sendChat(null)}
              onRunCommand={runPanelCommand}
              showDataBusy={compare.running}
              coverageAdjustment={compare.coverageAdjustment}
              onUseAvailableDates={() => void compare.run(true)}
              workspaceAnalysis={analysis}
              onRerunReport={handleDirectReportRun}
              hasPlaces={data.places.length > 0 || list.entries.length > 0}
              onAction={handlePanelAction}
              followupChips={chipRow}
              onFollowupChip={handleFollowupChip}
              expandedCard={expandedCard}
              currentCard={currentCard}
              onCardExpandChange={handleCardExpandChange}
              onUndoSettings={(settings) => {
                handleAnalysisChange(settings);
                thread.append({ kind: "receipt", text: "Previous filters restored." });
              }}
              focusCard={focusCard}
              exportHrefBase={exportHrefBase}
              paneActions={paneActions}
              areaInspector={areaInspectorOpen && areaGeometry ? (
                <AreaSelectionCard
                  summary={areaSelection.summary}
                  baseSummary={areaSelection.baseSummary}
                  summaryLoading={areaSelection.summaryLoading}
                  records={areaSelection.records}
                  recordsLoading={areaSelection.recordsLoading}
                  error={areaSelection.error}
                  noun={incidentNoun(analysis.layer)}
                  analysisStartDate={analysis.startDate}
                  analysisEndDate={analysis.endDate}
                  pageSize={areaSelection.pageSize}
                  pageNumber={areaSelection.pageNumber}
                  canPrevious={areaSelection.canPrevious}
                  canNext={areaSelection.canNext}
                  filters={areaSelection.filters}
                  onPageSize={areaSelection.setPageSize}
                  onPrevious={areaSelection.previousPage}
                  onNext={areaSelection.nextPage}
                  onToggleType={areaSelection.toggleType}
                  onToggleHour={areaSelection.toggleHour}
                  onToggleDay={areaSelection.toggleDay}
                  onClearFilters={areaSelection.clearFilters}
                  onRedraw={startAreaDraw}
                  onClear={clearAreaSelection}
                  onClose={() => setAreaInspectorOpen(false)}
                  onExport={areaSelection.downloadCsv}
                />
              ) : undefined}
              errorLine={data.error}
              contextStrip={
                <ContextStrip
                  analysis={analysis}
                  availableRadii={data.availableRadii}
                  onChange={handleAnalysisChange}
                  layerAvailability={layerAvailability}
                  locationControls={locationControls}
                  metadata={isMobile ? freshnessIndicator : undefined}
                  onCopyLink={handleCopyLink}
                  copyDisabled={list.entries.length === 0}
                  compact={currentCard != null}
                  scopeLabel={list.entries.length === 1 ? list.entries[0].label : `${list.entries.length} places`}
                  placeCount={list.entries.length}
                  reportAction={currentCard == null && list.entries.length > 0 ? {
                    label: latestCard ? "Update report" : "Run report",
                    busy: compare.running,
                    disabled: !activeLayerAvailable,
                    disabledReason: !activeLayerAvailable ? "No data is loaded for this layer." : undefined,
                    onRun: handleDirectReportRun,
                  } : undefined}
                  assistantUpdatedFields={assistantUpdatedFields}
                />
              }
            />
          </div>
        </BottomSheet>

        {managePlaces ? (
          <ManagePlacesModal
            places={data.places}
            selectedIds={savedIdSet}
            analysisPlaceIds={pinIdSet}
            summary={data.summary}
            analysis={analysis}
            addPinMode={pinDraft.addPinMode}
            search={<PlaceSearch provider={geocodingProvider} onSelectResult={(result) => { setManagePlaces(null); pinDraft.handleSearchSelect(result); }} />}
            initialView={managePlaces}
            onStartAddPin={() => { setManagePlaces(null); pinDraft.startAddPin(); }}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDelete}
            canClearAll={clearablePlaces.length > 0 || adhocPlaces.length > 0 || Boolean(pinDraft.draft)}
            onClearAll={() => { setManagePlaces(null); requestClearPins(); }}
            onManualSubmit={handleManualSubmit}
            onImportSubmit={handleImport}
            onUploaded={data.personalUploadsEnabled ? () => data.refreshWithFallback("Uploaded, but dashboard totals could not refresh.") : undefined}
            onClose={() => setManagePlaces(null)}
            onToggleExport={handleToggleExport}
            exportHref={data.exportHref}
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

        {clearPinsOpen ? (
          <ClearPinsDialog
            savedPlaceCount={clearablePlaces.length}
            hasUnsavedPins={adhocPlaces.length > 0 || Boolean(pinDraft.draft)}
            busy={clearingPins}
            error={clearPinsError}
            onCancel={() => { if (!clearingPins) setClearPinsOpen(false); }}
            onConfirm={() => void handleClearPins()}
          />
        ) : null}

        {aboutOpen ? (
          <AboutModal
            onClose={() => setAboutOpen(false)}
            personalUploadsEnabled={data.personalUploadsEnabled}
          />
        ) : null}
      </div>
    </div>
  );
}
