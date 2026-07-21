import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { circlePolygonCoords } from "../lib/geodesy";
import { incidentCountForPlace } from "../lib/incidentSummaries";
import {
  BEATS_SOURCE,
  EMPTY_FC,
  incidentCardElement,
  INCIDENTS_SOURCE,
  registerDataLayers,
  RINGS_SOURCE,
} from "../lib/mapLayers";
import { buildMapStyle, cartoRasterStyle, fallbackMapStyle, type MapTheme, TILES_URL } from "../lib/mapStyle";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { IncidentFeatureCollection } from "../lib/useIncidentPoints";
import type { BeatFeatureCollection, DashboardSummary, DraftPin, LatLng, MapBounds, Place } from "../types";

const SEATTLE: [number, number] = [-122.3321, 47.6062]; // [lng, lat]

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
      ? "#74858E"
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
  radiusM: number,
): MarkerKind {
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;
  if (incidentCountForPlace(summary, place.id, radiusM) !== null) {
    return "analyzed";
  }
  // Ephemeral ad-hoc entries are never analyzable: no "low" state, no radius ring
  // (ringsGeoJSON derives from this kind), regardless of the global radius flag.
  if (place.inferred_place_type === "adhoc_entry") {
    return selectedIds.has(place.id) ? "selected" : "default";
  }
  if (analyzedAtRadius && selectedIds.has(place.id)) {
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
  radiusM: number,
): { type: "FeatureCollection"; features: RingFeature[] } {
  const features: RingFeature[] = [];
  for (const place of places) {
    if (place.latitude === null || place.longitude === null) continue;
    const kind = markerKindFor(place, selectedIds, summary, radiusM);
    if (kind !== "analyzed" && kind !== "low") continue;
    features.push({
      type: "Feature",
      properties: { kind },
      geometry: {
        type: "Polygon",
        coordinates: [circlePolygonCoords(place.latitude, place.longitude, radiusM)],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

let pmtilesProtocolRegistered = false;
function ensurePmtilesProtocol(): void {
  if (!pmtilesProtocolRegistered) {
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
  radiusM: number;
  flyTo: LatLng | null;
  beats: BeatFeatureCollection | null;
  highlightBeats: string[];
  incidentPoints: IncidentFeatureCollection | null;
  theme: MapTheme;
  identityByPlaceId?: Map<string, PlaceIdentity>;
  pulsePlaceId?: string | null;
  badgedPlaceIds?: Set<string>;
  fitTo?: { points: LatLng[]; padding: { top: number; right: number; bottom: number; left: number } } | null;
  onViewportChange?: (bounds: MapBounds) => void;
  onMapClick: (latlng: LatLng) => void;
  onMarkerClick: (placeId: string) => void;
  onBadgeClick?: (placeId: string) => void;
};

export function MapCanvas({
  places,
  selectedIds,
  draft,
  addPinMode,
  summary,
  radiusM,
  flyTo,
  beats,
  highlightBeats,
  incidentPoints,
  theme,
  identityByPlaceId,
  pulsePlaceId,
  badgedPlaceIds,
  fitTo,
  onViewportChange,
  onMapClick,
  onMarkerClick,
  onBadgeClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markerElsRef = useRef(new Map<string, HTMLElement>());
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onBadgeClickRef = useRef(onBadgeClick);
  const onViewportChangeRef = useRef(onViewportChange);
  const themeRef = useRef(theme);
  const tilesMissingRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [tilesMissing, setTilesMissing] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useLayoutEffect(() => {
    onMapClickRef.current = onMapClick;
    onMarkerClickRef.current = onMarkerClick;
    onBadgeClickRef.current = onBadgeClick;
    onViewportChangeRef.current = onViewportChange;
  });

  useEffect(() => {
    let cancelled = false;
    async function init() {
      ensurePmtilesProtocol();
      const useCarto = import.meta.env.VITE_MAP_BASEMAP === "carto";
      const available = useCarto
        ? true
        : await fetch(TILES_URL, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
      if (cancelled || !containerRef.current) return;
      tilesMissingRef.current = !useCarto && !available;
      setTilesMissing(!useCarto && !available);
      themeRef.current = theme;
      const style = useCarto
        ? cartoRasterStyle()
        : available
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
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("click", (event) => {
        onMapClickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      map.on("style.load", () => {
        registerDataLayers(map, themeRef.current);
        setStyleEpoch((n) => n + 1);
      });
      map.on("load", () => setMapReady(true));
      const emitViewport = () => {
        const b = map.getBounds();
        onViewportChangeRef.current?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      };
      map.on("moveend", emitViewport);
      map.on("load", emitViewport);
      map.on("click", "mc-incident-dot", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        new maplibregl.Popup({ offset: 10 })
          .setLngLat(event.lngLat)
          .setDOMContent(incidentCardElement(feature.properties ?? {}))
          .addTo(map);
      });
      map.on("click", "mc-incident-cluster", (event) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource(INCIDENTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (clusterId === undefined || !source) return;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (feature!.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
        }).catch(() => {});
      });
      for (const hoverable of ["mc-incident-dot", "mc-incident-cluster"]) {
        map.on("mouseenter", hoverable, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", hoverable, () => { map.getCanvas().style.cursor = ""; });
      }
      mapRef.current = map;
    }
    init();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || themeRef.current === theme) return;
    themeRef.current = theme;
    if (import.meta.env.VITE_MAP_BASEMAP === "carto") return; // escape hatch stays light-only
    map.setStyle(tilesMissingRef.current ? fallbackMapStyle(theme) : buildMapStyle(theme, window.location.origin));
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
      const kind = markerKindFor(place, selectedIds, summary, radiusM);
      const count = incidentCountForPlace(summary, place.id, radiusM);
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
  }, [places, selectedIds, summary, radiusM, draft, mapReady, identityByPlaceId, badgedPlaceIds]);

  useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      el.classList.toggle("is-pulsing", id === pulsePlaceId);
    }
  }, [pulsePlaceId, places, selectedIds, summary, radiusM, draft, mapReady, identityByPlaceId, badgedPlaceIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(RINGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(ringsGeoJSON(places, selectedIds, summary, radiusM));
  }, [places, selectedIds, summary, radiusM, mapReady, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !beats) return;
    (map.getSource(BEATS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      beats as unknown as GeoJSON.FeatureCollection,
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
    (map.getSource(INCIDENTS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      incidentPoints ?? EMPTY_FC,
    );
  }, [incidentPoints, mapReady, styleEpoch]);

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

  return (
    <div className={`mc-map${addPinMode ? " is-adding" : ""}`}>
      <div ref={containerRef} className="mc-map-canvas" />
      {mapFailed ? (
        <div className="mc-map-fallback" role="status">
          Map failed to initialize in this browser. Pins and analysis still work in the panel.
        </div>
      ) : tilesMissing ? (
        <div className="mc-map-fallback" role="status">
          Basemap tiles unavailable — run <code>make fetch-tiles</code>. Pins and analysis still work.
        </div>
      ) : null}
    </div>
  );
}
