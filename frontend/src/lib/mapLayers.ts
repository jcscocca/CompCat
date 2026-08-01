import * as maplibregl from "maplibre-gl";

import { formatIncidentAddress, titleCase } from "./addressLabel";
import type { IncidentNoun } from "./layerCopy";
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
export const INCIDENT_SELECTED_LAYER = "mc-incident-selected";
export const EMPTY_FC: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };
export const CLUSTER_MAX_ZOOM = 15; // clusters through z15, precise block markers at z16+
export const PRECISE_LOCATION_MIN_ZOOM = CLUSTER_MAX_ZOOM + 1;
export const CLUSTER_LABEL_MIN_ZOOM = 12;
export const CLUSTER_LABEL_MIN_COUNT = 25;
export const STACK_LABEL_MIN_ZOOM = PRECISE_LOCATION_MIN_ZOOM;
export const STACK_LABEL_MIN_COUNT = 10;

export function incidentSelectionFilter(id: string | null): maplibregl.FilterSpecification {
  return [
    "all",
    ["!", ["has", "point_count"]],
    ["==", ["get", "id"], id ?? "__no_selected_incident__"],
  ];
}

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

export function addIncidentLayers(map: maplibregl.Map, theme: MapTheme): void {
  const selectedColor = theme === "dark" ? "#3FBF8F" : "#0F6E56";
  const labelColor = theme === "dark" ? "#E8EDF2" : "#3A3F46";
  const labelHalo = theme === "dark" ? "#141A20" : "#FFFFFF";
  map.addSource(INCIDENTS_SOURCE, {
    type: "geojson",
    data: EMPTY_FC,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 40,
    // The source has one feature per block-level coordinate. Sum the records represented by
    // those locations so a cluster label never falls back to counting visible dots.
    clusterProperties: {
      record_count: ["+", ["get", "record_count"]],
    },
  });
  // One calm neutral for clusters and dots — never severity colors (product invariant).
  map.addLayer({
    id: "mc-incident-cluster",
    type: "circle",
    source: INCIDENTS_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#3A3F46",
      // The default view communicates relative volume without turning each aggregate into a
      // heavy numbered bubble. Radius follows a capped square-root scale, so area remains the
      // magnitude cue without allowing the largest downtown cluster to dominate the map.
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.42, 12, 0.6],
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["sqrt", ["min", ["get", "record_count"], 500]],
        1,
        5,
        3.1622776602,
        7,
        10,
        12,
        22.360679775,
        18,
      ],
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 0.75,
    },
  });
  map.addLayer({
    id: "mc-incident-cluster-count",
    type: "symbol",
    source: INCIDENTS_SOURCE,
    minzoom: CLUSTER_LABEL_MIN_ZOOM,
    filter: [
      "all",
      ["has", "point_count"],
      [">=", ["get", "record_count"], CLUSTER_LABEL_MIN_COUNT],
    ],
    layout: {
      "text-field": ["number-format", ["get", "record_count"], { locale: "en-US", "max-fraction-digits": 0 }],
      "text-font": ["Noto Sans Medium"],
      "text-size": 10.5,
      "text-padding": 4,
      "text-allow-overlap": false,
    },
    paint: { "text-color": "#FFFFFF" },
  });
  map.addLayer({
    id: "mc-incident-dot",
    type: "circle",
    source: INCIDENTS_SOURCE,
    minzoom: PRECISE_LOCATION_MIN_ZOOM,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0.72,
      // Preserve one precise marker per block location without letting a count turn it into
      // a dominant bubble. Exact record counts remain available in the click card.
      "circle-radius": ["step", ["get", "record_count"], 4.5, 2, 5.5, 10, 7, 100, 8.5],
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 0.75,
    },
  });
  map.addLayer({
    id: INCIDENT_SELECTED_LAYER,
    type: "circle",
    source: INCIDENTS_SOURCE,
    minzoom: PRECISE_LOCATION_MIN_ZOOM,
    filter: incidentSelectionFilter(null),
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0,
      "circle-radius": ["step", ["get", "record_count"], 9.5, 2, 10.5, 10, 12, 100, 13.5],
      "circle-stroke-color": selectedColor,
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "mc-incident-stack-count",
    type: "symbol",
    source: INCIDENTS_SOURCE,
    minzoom: STACK_LABEL_MIN_ZOOM,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      [">=", ["get", "record_count"], STACK_LABEL_MIN_COUNT],
    ],
    layout: {
      "text-field": ["number-format", ["get", "record_count"], { locale: "en-US", "max-fraction-digits": 0 }],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
      "text-anchor": "bottom-left",
      "text-offset": [0.65, -0.5],
      "text-padding": 3,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": labelColor,
      "text-halo-color": labelHalo,
      "text-halo-width": 2,
    },
  });
  // Keep compact markers easy to click and tap without adding visible map ink.
  map.addLayer({
    id: "mc-incident-hit",
    type: "circle",
    source: INCIDENTS_SOURCE,
    minzoom: PRECISE_LOCATION_MIN_ZOOM,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#3A3F46",
      "circle-opacity": 0,
      "circle-radius": 13,
      "circle-stroke-width": 0,
    },
  });
}

export function registerDataLayers(map: maplibregl.Map, theme: MapTheme): void {
  addBeatLayers(map);
  addRingLayers(map, theme);
  addIncidentLayers(map, theme);
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function incidentCardElement(props: Record<string, unknown>, noun: IncidentNoun): HTMLElement {
  // textContent only — properties come from SPD strings; never parse them as HTML.
  const card = document.createElement("div");
  card.className = "mc-incident-card";
  const title = document.createElement("strong");
  const recordCount = Number(props.record_count ?? 1);
  if (Number.isFinite(recordCount) && recordCount > 1) {
    title.textContent = `${recordCount.toLocaleString("en-US")} ${noun.plural}`;
    const note = document.createElement("div");
    note.textContent = `These ${noun.plural} are mapped to the same block.`;
    const latest = document.createElement("div");
    latest.textContent = props.occurred_at
      ? `Latest record: ${String(props.occurred_at).slice(0, 10)}`
      : "Dates not recorded";
    card.append(title, note, latest);
    return card;
  }
  const rawTitle = props.offense_subcategory ?? props.offense_category;
  title.textContent = rawTitle ? titleCase(String(rawTitle)) : sentenceCase(noun.singular);
  const kind = document.createElement("div");
  kind.className = "mc-incident-kind";
  kind.textContent = sentenceCase(noun.singular);
  const when = document.createElement("div");
  when.textContent = props.occurred_at ? String(props.occurred_at).slice(0, 10) : "date not recorded";
  const where = document.createElement("div");
  where.textContent = formatIncidentAddress(props.block_address as string | null | undefined);
  card.append(title);
  if (rawTitle) card.append(kind);
  card.append(when, where);
  return card;
}

export function incidentClusterCardElement(props: Record<string, unknown>, noun: IncidentNoun): HTMLElement {
  const card = document.createElement("div");
  card.className = "mc-incident-card";
  const title = document.createElement("strong");
  const recordCount = Number(props.record_count ?? 0);
  title.textContent = Number.isFinite(recordCount)
    ? `${recordCount.toLocaleString("en-US")} ${noun.plural}`
    : `Grouped ${noun.plural}`;
  const note = document.createElement("div");
  note.textContent = "Grouped in this map view. Zooming in shows their block locations.";
  card.append(title, note);
  return card;
}
