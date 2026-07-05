import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { circlePolygonCoords } from "../lib/geodesy";
import { incidentCountForPlace } from "../lib/incidentSummaries";
import { buildMapStyle, cartoRasterStyle, fallbackMapStyle, TILES_URL } from "../lib/mapStyle";
import type { DashboardSummary, DraftPin, LatLng, Place } from "../types";

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

export function iconHtml(kind: MarkerKind, opts: { count?: number | null; label?: string }): string {
  if (kind === "selected") {
    const label = opts.label ? escapeHtml(opts.label) : "";
    return `<span class="mc-pin-halo"></span>${teardrop("#CD6A45", DOT)}<span class="mc-pin-tag">${label}</span>`;
  }
  if (kind === "analyzed") {
    return `${teardrop("#3A3F46", DOT)}<span class="mc-pin-badge"><b>${opts.count ?? 0}</b><i>inc.</i></span>`;
  }
  if (kind === "low") {
    return teardrop("#74858E", QGLYPH);
  }
  return teardrop("#3A3F46", DOT);
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

const RINGS_SOURCE = "mc-rings";

// Added once on "load". A future setStyle() (slice 3 dark mode) wipes these layers
// and "load" does NOT re-fire — re-adding needs style.load/transformStyle.
function addRingLayers(map: maplibregl.Map): void {
  map.addSource(RINGS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "mc-ring-fill",
    type: "fill",
    source: RINGS_SOURCE,
    paint: {
      "fill-color": ["match", ["get", "kind"], "analyzed", "#CD6A45", "#74858E"],
      "fill-opacity": ["match", ["get", "kind"], "analyzed", 0.15, 0.12],
    },
  });
  map.addLayer({
    id: "mc-ring-line",
    type: "line",
    source: RINGS_SOURCE,
    filter: ["==", ["get", "kind"], "analyzed"],
    paint: { "line-color": "#CD6A45", "line-width": 1.5 },
  });
  map.addLayer({
    id: "mc-ring-line-dashed",
    type: "line",
    source: RINGS_SOURCE,
    filter: ["==", ["get", "kind"], "low"],
    paint: { "line-color": "#74858E", "line-width": 1.5, "line-dasharray": [2, 2] },
  });
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
  onMapClick: (latlng: LatLng) => void;
  onMarkerClick: (placeId: string) => void;
};

export function MapCanvas({
  places,
  selectedIds,
  draft,
  addPinMode,
  summary,
  radiusM,
  flyTo,
  onMapClick,
  onMarkerClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const [mapReady, setMapReady] = useState(false);
  const [tilesMissing, setTilesMissing] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useLayoutEffect(() => {
    onMapClickRef.current = onMapClick;
    onMarkerClickRef.current = onMarkerClick;
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
      setTilesMissing(!useCarto && !available);
      const style = useCarto
        ? cartoRasterStyle()
        : available
          ? buildMapStyle("light", window.location.origin)
          : fallbackMapStyle("light");
      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: SEATTLE,
          // MapLibre zoom is 512px-tile-based; 11 here ≈ the old Leaflet (256px) zoom 12.
          zoom: 11,
          attributionControl: {},
        });
      } catch {
        setMapFailed(true);
        return;
      }
      map.on("click", (event) => {
        onMapClickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      map.on("load", () => {
        addRingLayers(map);
        setMapReady(true);
      });
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
    if (!map || !mapReady) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    for (const place of places) {
      if (place.latitude === null || place.longitude === null) continue;
      const kind = markerKindFor(place, selectedIds, summary, radiusM);
      const count = incidentCountForPlace(summary, place.id, radiusM);
      const el = document.createElement("div");
      el.className = "mc-pin-icon";
      el.innerHTML = iconHtml(kind, { count, label: place.display_label });
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", place.display_label);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onMarkerClickRef.current(place.id);
      });
      el.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.key === " ") event.preventDefault();
        onMarkerClickRef.current(place.id);
      });
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map),
      );
    }
    if (draft) {
      const el = document.createElement("div");
      el.className = "mc-pin-icon mc-pin-draft";
      el.innerHTML = teardrop("#B5512F", DOT);
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([draft.longitude, draft.latitude])
          .addTo(map),
      );
    }
  }, [places, selectedIds, summary, radiusM, draft, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(RINGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(ringsGeoJSON(places, selectedIds, summary, radiusM));
  }, [places, selectedIds, summary, radiusM, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    // Floor 14 ≈ the old Leaflet flyTo floor of 15 (512px- vs 256px-tile zoom offset).
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [flyTo, mapReady]);

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
