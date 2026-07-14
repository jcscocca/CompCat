import maplibregl from "maplibre-gl";

import { formatIncidentAddress, titleCase } from "./addressLabel";
import type { MapTheme } from "./mapStyle";
import type { IncidentFeatureCollection } from "./useIncidentPoints";

export const RINGS_SOURCE = "mc-rings";

// Added on "style.load" (re-fires after setStyle, so the layers survive a theme swap).
// The analyzed ring uses fixed hexes — canvas paint can't read CSS vars. The dark value
// mirrors the dark --accent so the ring reads against the dark basemap.
export function addRingLayers(map: maplibregl.Map, theme: MapTheme): void {
  const analyzedColor = theme === "dark" ? "#3FBF8F" : "#0F6E56";
  map.addSource(RINGS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "mc-ring-fill",
    type: "fill",
    source: RINGS_SOURCE,
    paint: {
      "fill-color": ["match", ["get", "kind"], "analyzed", analyzedColor, "#74858E"],
      "fill-opacity": ["match", ["get", "kind"], "analyzed", 0.15, 0.12],
    },
  });
  map.addLayer({
    id: "mc-ring-line",
    type: "line",
    source: RINGS_SOURCE,
    filter: ["==", ["get", "kind"], "analyzed"],
    paint: { "line-color": analyzedColor, "line-width": 1.5 },
  });
  map.addLayer({
    id: "mc-ring-line-dashed",
    type: "line",
    source: RINGS_SOURCE,
    filter: ["==", ["get", "kind"], "low"],
    paint: { "line-color": "#74858E", "line-width": 1.5, "line-dasharray": [2, 2] },
  });
}

export const BEATS_SOURCE = "mc-beats";
export const INCIDENTS_SOURCE = "mc-incidents";
export const EMPTY_FC: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };
export const CLUSTER_MAX_ZOOM = 13; // clusters below, individual dots at z14+ (spec: initial threshold)

export function addBeatLayers(map: maplibregl.Map): void {
  map.addSource(BEATS_SOURCE, { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "mc-beat-highlight",
    type: "fill",
    source: BEATS_SOURCE,
    filter: ["in", ["get", "beat"], ["literal", []]],
    paint: { "fill-color": "#74858E", "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: "mc-beat-line",
    type: "line",
    source: BEATS_SOURCE,
    paint: { "line-color": "#74858E", "line-width": 1, "line-opacity": 0.5 },
  });
  map.addLayer({
    id: "mc-beat-label",
    type: "symbol",
    source: BEATS_SOURCE,
    minzoom: 12,
    layout: {
      "text-field": ["get", "beat"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
    },
    paint: { "text-color": "#74858E", "text-opacity": 0.75, "text-halo-color": "#FFFFFF", "text-halo-width": 1 },
  });
}

export function addIncidentLayers(map: maplibregl.Map): void {
  map.addSource(INCIDENTS_SOURCE, {
    type: "geojson",
    data: EMPTY_FC,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 40,
  });
  // One calm neutral for clusters and dots — never severity colors (product invariant).
  map.addLayer({
    id: "mc-incident-cluster",
    type: "circle",
    source: INCIDENTS_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0.85,
      "circle-radius": ["step", ["get", "point_count"], 12, 25, 16, 100, 22],
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "mc-incident-cluster-count",
    type: "symbol",
    source: INCIDENTS_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
    },
    paint: { "text-color": "#FFFFFF" },
  });
  map.addLayer({
    id: "mc-incident-dot",
    type: "circle",
    source: INCIDENTS_SOURCE,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0.85,
      "circle-radius": 4.5,
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 1,
    },
  });
}

export function registerDataLayers(map: maplibregl.Map, theme: MapTheme): void {
  addBeatLayers(map);
  addRingLayers(map, theme);
  addIncidentLayers(map);
}

export function incidentCardElement(props: Record<string, unknown>): HTMLElement {
  // textContent only — properties come from SPD strings; never parse them as HTML.
  const card = document.createElement("div");
  card.className = "mc-incident-card";
  const title = document.createElement("strong");
  const rawTitle = props.offense_subcategory ?? props.offense_category;
  title.textContent = rawTitle ? titleCase(String(rawTitle)) : "Incident";
  const when = document.createElement("div");
  when.textContent = props.occurred_at ? String(props.occurred_at).slice(0, 10) : "date not recorded";
  const where = document.createElement("div");
  where.textContent = formatIncidentAddress(props.block_address as string | null | undefined);
  card.append(title, when, where);
  return card;
}
