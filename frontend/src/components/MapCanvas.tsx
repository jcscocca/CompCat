import * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { Protocol } from "pmtiles";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import { circlePolygonCoords } from "../lib/geodesy";
import { hasIncidentSummaryForAnalysis, incidentCountForPlace } from "../lib/incidentSummaries";
import type { IncidentNoun } from "../lib/layerCopy";
import {
  BEATS_SOURCE,
  AREA_HIGHLIGHTS_SOURCE,
  AREA_SHAPE_SOURCE,
  EMPTY_FC,
  incidentCardElement,
  incidentClusterCardElement,
  incidentSelectionFilter,
  INCIDENT_SELECTED_LAYER,
  INCIDENTS_SOURCE,
  registerDataLayers,
  RINGS_SOURCE,
} from "../lib/mapLayers";
import { buildMapStyle, fallbackMapStyle, type MapTheme, TILES_URL } from "../lib/mapStyle";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { IncidentFeatureCollection } from "../lib/useIncidentPoints";
import type { AnalysisSettings, AreaDrawMode, AreaPolygonGeometry, BeatFeatureCollection, DashboardSummary, DraftPin, LatLng, MapBounds, Place } from "../types";

const SEATTLE: [number, number] = [-122.3321, 47.6062]; // [lng, lat]
const TRACKPAD_ZOOM_RATE = 1 / 180;
const WHEEL_ZOOM_RATE = 1 / 600;

export type MarkerKind = "default" | "selected" | "analyzed" | "low";

const DOT = '<circle cx="12" cy="11.5" r="4.4" fill="#fff"/>';
const QGLYPH = '<text x="12" y="16" font-size="13" fill="#fff" text-anchor="middle" font-family="Archivo" font-weight="700">?</text>';
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function teardrop(fill: string, glyph: string): string {
  return `<svg width="28" height="36" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="${fill}"/>${glyph}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

function letterGlyph(letter: string): string {
  return `<text x="12" y="16" font-size="11" fill="#fff" text-anchor="middle" font-family="Archivo" font-weight="700">${escapeHtml(letter)}</text>`;
}

export function iconHtml(
  kind: MarkerKind,
  opts: { count?: number | null; label?: string; identity?: PlaceIdentity },
): string {
  const fill = opts.identity
    ? `var(--id-${opts.identity.slot})`
    : kind === "low"
      ? "var(--id-x)"
      : kind === "selected"
        ? "var(--accent)"
        : "#3A3F46";
  const glyph = opts.identity ? letterGlyph(opts.identity.letter) : kind === "low" ? QGLYPH : DOT;
  if (kind === "selected") {
    const label = opts.label ? escapeHtml(opts.label) : "";
    return `<span class="mc-pin-halo"></span>${teardrop(fill, glyph)}<span class="mc-pin-tag">${label}</span>`;
  }
  if (kind === "analyzed") {
    return `${teardrop(fill, glyph)}<span class="mc-pin-badge"><b>${opts.count ?? 0}</b><i>inc.</i></span>`;
  }
  return teardrop(fill, glyph);
}

export function markerKindFor(
  place: Place,
  selectedIds: Set<string>,
  summary: DashboardSummary | null,
  analysis: AnalysisSettings,
): MarkerKind {
  const analyzedInScope = hasIncidentSummaryForAnalysis(summary, analysis, selectedIds);
  if (incidentCountForPlace(summary, place.id, analysis, selectedIds) !== null) {
    return "analyzed";
  }
  // Ephemeral ad-hoc entries are never analyzable: no "low" state, no radius ring
  // (ringsGeoJSON derives from this kind), regardless of the global radius flag.
  if (place.inferred_place_type === "adhoc_entry") {
    return selectedIds.has(place.id) ? "selected" : "default";
  }
  if (analyzedInScope && selectedIds.has(place.id)) {
    return "low";
  }
  if (selectedIds.has(place.id)) {
    return "selected";
  }
  return "default";
}

type RingFeature = {
  type: "Feature";
  properties: { kind: "analyzed" | "low" };
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
};

export function ringsGeoJSON(
  places: Place[],
  selectedIds: Set<string>,
  summary: DashboardSummary | null,
  analysis: AnalysisSettings,
): { type: "FeatureCollection"; features: RingFeature[] } {
  const features: RingFeature[] = [];
  for (const place of places) {
    if (place.latitude === null || place.longitude === null) continue;
    const kind = markerKindFor(place, selectedIds, summary, analysis);
    if (kind !== "analyzed" && kind !== "low") continue;
    features.push({
      type: "Feature",
      properties: { kind },
      geometry: {
        type: "Polygon",
        coordinates: [circlePolygonCoords(place.latitude, place.longitude, analysis.radiusM)],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

let pmtilesProtocolRegistered = false;
function ensurePmtilesProtocol(): void {
  if (!pmtilesProtocolRegistered) {
    // v6's default worker URL is a sibling of the bundled chunk, which vite does
    // not emit; point it at the copy shipped by the maplibre-worker-assets plugin.
    if (import.meta.env.PROD) {
      maplibregl.setWorkerUrl("/assets/maplibre/maplibre-gl-worker.mjs");
    }
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    pmtilesProtocolRegistered = true;
  }
}

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  draft: DraftPin | null;
  addPinMode: boolean;
  summary: DashboardSummary | null;
  analysis: AnalysisSettings;
  flyTo: LatLng | null;
  beats: BeatFeatureCollection | null;
  highlightBeats: string[];
  incidentPoints: IncidentFeatureCollection | null;
  areaGeometry?: AreaPolygonGeometry | null;
  areaHighlights?: IncidentFeatureCollection | null;
  areaDrawMode?: AreaDrawMode | null;
  incidentNoun: IncidentNoun;
  theme: MapTheme;
  identityByPlaceId?: Map<string, PlaceIdentity>;
  pulsePlaceId?: string | null;
  badgedPlaceIds?: Set<string>;
  fitTo?: { points: LatLng[]; padding: { top: number; right: number; bottom: number; left: number } } | null;
  onViewportChange?: (bounds: MapBounds) => void;
  onMapClick: (latlng: LatLng) => void;
  onMarkerClick: (placeId: string) => void;
  onBadgeClick?: (placeId: string) => void;
  onAreaComplete?: (geometry: AreaPolygonGeometry) => void;
  onAreaCancel?: () => void;
  /** Preserve the locator-strip visual while removing covered map controls from focus/AT. */
  interactionDisabled?: boolean;
};

export function MapCanvas({
  places,
  selectedIds,
  draft,
  addPinMode,
  summary,
  analysis,
  flyTo,
  beats,
  highlightBeats,
  incidentPoints,
  areaGeometry = null,
  areaHighlights = null,
  areaDrawMode = null,
  incidentNoun,
  theme,
  identityByPlaceId,
  pulsePlaceId,
  badgedPlaceIds,
  fitTo,
  onViewportChange,
  onMapClick,
  onMarkerClick,
  onBadgeClick,
  onAreaComplete,
  onAreaCancel,
  interactionDisabled = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const markerElsRef = useRef(new Map<string, HTMLElement>());
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onBadgeClickRef = useRef(onBadgeClick);
  const onViewportChangeRef = useRef(onViewportChange);
  const incidentNounRef = useRef(incidentNoun);
  const incidentPopupRef = useRef<maplibregl.Popup | null>(null);
  const themeRef = useRef(theme);
  const selectedIncidentIdRef = useRef<string | null>(null);
  const tilesMissingRef = useRef(false);
  const drawOverlayRef = useRef<HTMLDivElement>(null);
  const drawPixelsRef = useRef<Array<[number, number]>>([]);
  const [drawPixels, setDrawPixels] = useState<Array<[number, number]>>([]);
  const [mapReady, setMapReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [tilesMissing, setTilesMissing] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useLayoutEffect(() => {
    onMapClickRef.current = onMapClick;
    onMarkerClickRef.current = onMarkerClick;
    onBadgeClickRef.current = onBadgeClick;
    onViewportChangeRef.current = onViewportChange;
    incidentNounRef.current = incidentNoun;
  });

  useEffect(() => {
    drawPixelsRef.current = [];
    setDrawPixels([]);
    if (areaDrawMode) drawOverlayRef.current?.focus();
  }, [areaDrawMode]);

  useEffect(() => {
    const popup = incidentPopupRef.current;
    incidentPopupRef.current = null;
    popup?.remove();
    selectedIncidentIdRef.current = null;
    const map = mapRef.current;
    if (map?.getLayer(INCIDENT_SELECTED_LAYER)) {
      map.setFilter(INCIDENT_SELECTED_LAYER, incidentSelectionFilter(null));
    }
  }, [incidentNoun.singular, incidentNoun.plural]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      ensurePmtilesProtocol();
      const available = await fetch(TILES_URL, { method: "HEAD" })
        .then((response) => response.ok)
        .catch(() => false);
      if (cancelled || !containerRef.current) return;
      tilesMissingRef.current = !available;
      setTilesMissing(!available);
      themeRef.current = theme;
      const style = available
        ? buildMapStyle(theme, window.location.origin)
        : fallbackMapStyle(theme);
      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: SEATTLE,
          // MapLibre zoom is 512px-tile-based; 11 here ≈ the old 256px-tile zoom 12.
          zoom: 11,
          attributionControl: {},
        });
      } catch {
        setMapFailed(true);
        return;
      }
      // MapLibre's defaults react too aggressively to small wheel/trackpad corrections.
      // Keep camera motion direct while giving people room to settle on a useful view.
      map.scrollZoom.setZoomRate(TRACKPAD_ZOOM_RATE);
      map.scrollZoom.setWheelZoomRate(WHEEL_ZOOM_RATE);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("click", (event) => {
        onMapClickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      map.on("style.load", () => {
        registerDataLayers(map, themeRef.current);
        map.setFilter(INCIDENT_SELECTED_LAYER, incidentSelectionFilter(selectedIncidentIdRef.current));
        setStyleEpoch((n) => n + 1);
      });
      map.on("load", () => setMapReady(true));
      const emitViewport = () => {
        const b = map.getBounds();
        onViewportChangeRef.current?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      };
      map.on("moveend", emitViewport);
      map.on("load", emitViewport);
      map.on("click", "mc-incident-hit", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const incidentId = typeof feature.properties?.id === "string" ? feature.properties.id : null;
        const popup = new maplibregl.Popup({ offset: 10 })
          .setLngLat(event.lngLat)
          .setDOMContent(incidentCardElement(feature.properties ?? {}, incidentNounRef.current));
        popup.on("close", () => {
          if (incidentPopupRef.current === popup) incidentPopupRef.current = null;
        });
        if (incidentId) {
          popup.on("close", () => {
            if (selectedIncidentIdRef.current !== incidentId) return;
            selectedIncidentIdRef.current = null;
            if (map.getLayer(INCIDENT_SELECTED_LAYER)) {
              map.setFilter(INCIDENT_SELECTED_LAYER, incidentSelectionFilter(null));
            }
          });
        }
        popup.addTo(map);
        incidentPopupRef.current = popup;
        selectedIncidentIdRef.current = incidentId;
        map.setFilter(INCIDENT_SELECTED_LAYER, incidentSelectionFilter(incidentId));
      });
      map.on("click", "mc-incident-cluster", (event) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource(INCIDENTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (!feature || clusterId === undefined || !source) return;
        const popup = new maplibregl.Popup({ offset: 18 })
          .setLngLat(event.lngLat)
          .setDOMContent(incidentClusterCardElement(feature.properties ?? {}, incidentNounRef.current))
          .addTo(map);
        popup.on("close", () => {
          if (incidentPopupRef.current === popup) incidentPopupRef.current = null;
        });
        incidentPopupRef.current = popup;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (feature!.geometry as Point).coordinates as [number, number], zoom });
        }).catch(() => {});
      });
      for (const hoverable of ["mc-incident-hit", "mc-incident-cluster"]) {
        map.on("mouseenter", hoverable, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", hoverable, () => { map.getCanvas().style.cursor = ""; });
      }
      // maplibre-gl v6.0.0's trackResize observer never fires (manual resize()
      // works), so follow container size changes ourselves.
      if (typeof ResizeObserver !== "undefined") {
        resizeObserverRef.current = new ResizeObserver(() => map.resize());
        resizeObserverRef.current.observe(containerRef.current);
      }
      mapRef.current = map;
    }
    init();
    return () => {
      cancelled = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      incidentPopupRef.current?.remove();
      incidentPopupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || themeRef.current === theme) return;
    themeRef.current = theme;
    // diff:false is load-bearing. maplibre-gl v6 implements setSprite/setGlyphs as diff
    // operations (v5 rejected them as unimplemented and rebuilt the style from scratch), so
    // the default diffing path now applies a theme swap in place — and leaves the canvas a
    // full toggle behind: the map keeps painting the previous style until the *next*
    // setStyle. Forcing the rebuild restores the v5 behaviour and re-fires style.load, which
    // is what re-registers the data layers.
    map.setStyle(
      tilesMissingRef.current ? fallbackMapStyle(theme) : buildMapStyle(theme, window.location.origin),
      { diff: false },
    );
  }, [theme, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    // Markers only need the Map instance, but they share the rings' mapReady gate so a
    // single state drives both effects; accepted trade-off — pins wait for style load.
    if (!map || !mapReady) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    markerElsRef.current.clear();
    for (const place of places) {
      if (place.latitude === null || place.longitude === null) continue;
      const kind = markerKindFor(place, selectedIds, summary, analysis);
      const count = incidentCountForPlace(summary, place.id, analysis, selectedIds);
      const el = document.createElement("div");
      el.className = "mc-pin-icon";
      const markerButton = document.createElement("button");
      markerButton.type = "button";
      markerButton.className = "mc-pin-main";
      markerButton.innerHTML = iconHtml(kind, { count, label: place.display_label, identity: identityByPlaceId?.get(place.id) });
      markerButton.setAttribute("aria-label", place.display_label);
      markerButton.addEventListener("click", (event) => {
        event.stopPropagation();
        onMarkerClickRef.current(place.id);
      });
      el.appendChild(markerButton);
      if (badgedPlaceIds?.has(place.id)) {
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = "mc-pin-presence";
        badge.setAttribute("aria-label", "Analyzed — view context");
        badge.addEventListener("click", (event) => {
          event.stopPropagation();
          onBadgeClickRef.current?.(place.id);
        });
        el.appendChild(badge);
      }
      markerElsRef.current.set(place.id, el);
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
      // MapLibre makes every custom marker wrapper a role=button. The wrapper here is
      // only positional; its independently labelled marker and presence controls are
      // the interactive elements. Remove the generated semantics after addTo so the
      // accessibility tree does not contain nested buttons.
      el.removeAttribute("aria-label");
      el.removeAttribute("role");
      markersRef.current.push(marker);
    }
    if (draft) {
      const el = document.createElement("div");
      el.className = "mc-pin-icon mc-pin-draft";
      el.innerHTML = teardrop("var(--accent-deep)", DOT);
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([draft.longitude, draft.latitude])
        .addTo(map);
      el.removeAttribute("aria-label");
      el.removeAttribute("role");
      markersRef.current.push(marker);
    }
  }, [places, selectedIds, summary, analysis, draft, mapReady, identityByPlaceId, badgedPlaceIds]);

  useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      el.classList.toggle("is-pulsing", id === pulsePlaceId);
    }
  }, [pulsePlaceId, places, selectedIds, summary, analysis, draft, mapReady, identityByPlaceId, badgedPlaceIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(RINGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(ringsGeoJSON(places, selectedIds, summary, analysis));
  }, [places, selectedIds, summary, analysis, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !beats) return;
    (map.getSource(BEATS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      beats as unknown as FeatureCollection,
    );
  }, [beats, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setFilter("mc-beat-highlight", ["in", ["get", "beat"], ["literal", highlightBeats]]);
  }, [highlightBeats, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // A viewport/filter refresh replaces the point collection even when the layer noun stays
    // the same. Close any card selected from the prior collection so stale record details do
    // not linger after its source dots have been cleared or replaced.
    const popup = incidentPopupRef.current;
    incidentPopupRef.current = null;
    popup?.remove();
    selectedIncidentIdRef.current = null;
    if (map.getLayer(INCIDENT_SELECTED_LAYER)) {
      map.setFilter(INCIDENT_SELECTED_LAYER, incidentSelectionFilter(null));
    }
    (map.getSource(INCIDENTS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      incidentPoints ?? EMPTY_FC,
    );
  }, [incidentPoints, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const shape = areaGeometry ? {
      type: "FeatureCollection" as const,
      features: [{
        type: "Feature" as const,
        properties: {},
        geometry: areaGeometry,
      }],
    } : EMPTY_FC;
    (map.getSource(AREA_SHAPE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(shape);
  }, [areaGeometry, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource(AREA_HIGHLIGHTS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      areaHighlights ?? EMPTY_FC,
    );
  }, [areaHighlights, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    // Floor 14 ≈ the old flyTo floor of 15 (512px- vs 256px-tile zoom offset).
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [flyTo, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo || fitTo.points.length === 0) return;
    const bounds = fitTo.points.reduce(
      (acc, p) => acc.extend([p.lng, p.lat]),
      new maplibregl.LngLatBounds([fitTo.points[0].lng, fitTo.points[0].lat], [fitTo.points[0].lng, fitTo.points[0].lat]),
    );
    map.fitBounds(bounds, { padding: fitTo.padding, maxZoom: 16, duration: 600 });
  }, [fitTo, mapReady]);

  function overlayPoint(event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function finishPixels(raw: Array<[number, number]>) {
    const map = mapRef.current;
    if (!map) return;
    const distinct = raw.filter((point, index) => {
      if (index === 0) return true;
      const previous = raw[index - 1];
      return Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 2;
    });
    if (distinct.length < 3) return;
    const step = Math.max(1, Math.ceil(distinct.length / 249));
    const sampled = distinct.filter((_point, index) => index % step === 0).slice(0, 249);
    if (sampled.length < 3) return;
    const ring = sampled.map(([x, y]) => {
      const coordinate = map.unproject([x, y]);
      return [coordinate.lng, coordinate.lat] as [number, number];
    });
    ring.push([...ring[0]] as [number, number]);
    onAreaComplete?.({ type: "Polygon", coordinates: [ring] });
    drawPixelsRef.current = [];
    setDrawPixels([]);
  }

  function finishRectangle(start: [number, number], end: [number, number]) {
    if (Math.abs(end[0] - start[0]) < 5 || Math.abs(end[1] - start[1]) < 5) return;
    finishPixels([
      start,
      [end[0], start[1]],
      end,
      [start[0], end[1]],
    ]);
  }

  function useVisibleArea() {
    const map = mapRef.current;
    // Bottom-sheet and responsive layout changes can resize the canvas without a camera
    // gesture. Sync MapLibre's transform before reading bounds so this polygon matches the
    // area the person can actually see now, not the previous panel size.
    map?.resize();
    const bounds = map?.getBounds();
    if (!bounds) return;
    onAreaComplete?.({
      type: "Polygon",
      coordinates: [[
        [bounds.getWest(), bounds.getSouth()],
        [bounds.getEast(), bounds.getSouth()],
        [bounds.getEast(), bounds.getNorth()],
        [bounds.getWest(), bounds.getNorth()],
        [bounds.getWest(), bounds.getSouth()],
      ]],
    });
    drawPixelsRef.current = [];
    setDrawPixels([]);
  }

  function onDrawPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (areaDrawMode === "polygon") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = [overlayPoint(event)] as Array<[number, number]>;
    drawPixelsRef.current = next;
    setDrawPixels(next);
  }

  function onDrawPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const point = overlayPoint(event);
    const current = drawPixelsRef.current;
    const next = areaDrawMode === "rectangle"
      ? (current.length ? [current[0], point] : [point])
      : (() => {
          const last = current.at(-1);
          return last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 4
            ? current
            : [...current, point];
        })();
    if (next === current) return;
    drawPixelsRef.current = next;
    setDrawPixels(next);
  }

  function onDrawPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (areaDrawMode === "polygon") return;
    const point = overlayPoint(event);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const current = drawPixelsRef.current;
    if (areaDrawMode === "rectangle" && current[0]) {
      finishRectangle(current[0], point);
    } else if (areaDrawMode === "lasso") {
      finishPixels([...current, point]);
    }
  }

  function onDrawKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      drawPixelsRef.current = [];
      setDrawPixels([]);
      onAreaCancel?.();
    } else if (event.key === "Enter" && areaDrawMode === "polygon") {
      event.preventDefault();
      finishPixels(drawPixelsRef.current);
    } else if (event.key === "Backspace" && areaDrawMode === "polygon") {
      event.preventDefault();
      const next = drawPixelsRef.current.slice(0, -1);
      drawPixelsRef.current = next;
      setDrawPixels(next);
    }
  }

  const previewPixels = areaDrawMode === "rectangle" && drawPixels.length > 1
    ? [
        drawPixels[0],
        [drawPixels[1][0], drawPixels[0][1]] as [number, number],
        drawPixels[1],
        [drawPixels[0][0], drawPixels[1][1]] as [number, number],
      ]
    : drawPixels;

  return (
    <div
      className={`mc-map${addPinMode ? " is-adding" : ""}`}
      inert={interactionDisabled ? true : undefined}
      aria-hidden={interactionDisabled || undefined}
    >
      <div ref={containerRef} className="mc-map-canvas" />
      {areaDrawMode ? (
        <div
          ref={drawOverlayRef}
          className={`mc-area-draw-overlay is-${areaDrawMode}`}
          tabIndex={0}
          role="region"
          aria-label={`Draw a ${areaDrawMode} area. Escape cancels.`}
          onPointerDown={onDrawPointerDown}
          onPointerMove={onDrawPointerMove}
          onPointerUp={onDrawPointerUp}
          onClick={(event) => {
            if (areaDrawMode !== "polygon" || event.detail > 1) return;
            const point = overlayPoint(event);
            const next = [...drawPixelsRef.current, point];
            drawPixelsRef.current = next;
            setDrawPixels(next);
          }}
          onDoubleClick={(event) => {
            if (areaDrawMode !== "polygon") return;
            event.preventDefault();
            finishPixels(drawPixelsRef.current);
          }}
          onKeyDown={onDrawKeyDown}
        >
          <svg aria-hidden="true">
            {previewPixels.length > 1 ? (
              <polygon points={previewPixels.map(([x, y]) => `${x},${y}`).join(" ")} />
            ) : null}
            {areaDrawMode === "polygon" ? previewPixels.map(([x, y], index) => (
              <circle key={`${x}-${y}-${index}`} cx={x} cy={y} r="4" />
            )) : null}
          </svg>
          <div className="mc-area-draw-actions" onPointerDown={(event) => event.stopPropagation()}>
            <span>{areaDrawMode === "polygon" ? "Click points, then finish" : `Drag to draw ${areaDrawMode}`}</span>
            {areaDrawMode === "polygon" ? (
              <button type="button" disabled={drawPixels.length < 3} onClick={(event) => { event.stopPropagation(); finishPixels(drawPixelsRef.current); }}>Finish polygon</button>
            ) : null}
            <button type="button" onClick={(event) => { event.stopPropagation(); useVisibleArea(); }}>Use visible map area</button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onAreaCancel?.(); }}>Cancel</button>
          </div>
        </div>
      ) : null}
      {mapFailed ? (
        <div className="mc-map-fallback" role="status">
          Map failed to initialize in this browser. Pins and analysis still work in the panel.
        </div>
      ) : tilesMissing ? (
        <div className="mc-map-fallback" role="status">
          Basemap tiles are unavailable right now — pins and analysis still work.
        </div>
      ) : null}
    </div>
  );
}
