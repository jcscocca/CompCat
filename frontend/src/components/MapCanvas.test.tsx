// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// maplibre-gl needs WebGL; mock the whole module. Markers append their element to
// document.body so testing-library queries can see them.
vi.mock("maplibre-gl", () => {
  class MockMap {
    static last: MockMap | null = null;
    static lastOptions: Record<string, unknown> | null = null;
    handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    sources = new Map<string, {
      options?: Record<string, unknown>;
      setData: ReturnType<typeof vi.fn>;
      getClusterExpansionZoom: ReturnType<typeof vi.fn>;
    }>();
    layers: Array<Record<string, unknown>> = [];
    layerHandlers: Record<string, Array<(arg?: unknown) => void>> = {};
    constructor(options?: Record<string, unknown>) {
      MockMap.last = this;
      MockMap.lastOptions = options ?? null;
    }
    on(event: string, layerOrCb: unknown, maybeCb?: (arg?: unknown) => void) {
      if (typeof layerOrCb === "string" && maybeCb) {
        (this.layerHandlers[`${event}:${layerOrCb}`] ??= []).push(maybeCb);
        return this;
      }
      const cb = layerOrCb as (arg?: unknown) => void;
      (this.handlers[event] ??= []).push(cb);
      if (event === "load" || event === "style.load") cb();
      return this;
    }
    setStyle = vi.fn(function (this: MockMap) {
      this.sources.clear();
      this.layers = [];
      for (const cb of this.handlers["style.load"] ?? []) cb();
    });
    once(event: string, cb: (arg?: unknown) => void) {
      return this.on(event, cb);
    }
    addSource(id: string, options: Record<string, unknown>) {
      if (this.sources.has(id)) throw new Error(`Source "${id}" already exists`);
      this.sources.set(id, {
        options,
        setData: vi.fn(),
        getClusterExpansionZoom: vi.fn().mockResolvedValue(13),
      });
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    getLayer(id: string) {
      return this.layers.find((entry) => entry.id === id);
    }
    addLayer(layer: Record<string, unknown>) {
      this.layers.push(layer);
    }
    setFilter(id: string, filter: unknown) {
      const layer = this.layers.find((entry) => entry.id === id);
      if (layer) layer.filter = filter;
    }
    addControl() {}
    getZoom() {
      return 12;
    }
    flyTo = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    remove() {}
    fireClick(lat: number, lng: number) {
      for (const cb of this.handlers.click ?? []) cb({ lngLat: { lat, lng } });
    }
    fireLayerClick(layerId: string, feature: Record<string, unknown>, lngLat = { lng: -122.33, lat: 47.61 }) {
      for (const cb of this.layerHandlers[`click:${layerId}`] ?? []) {
        cb({ features: [feature], lngLat });
      }
    }
    getBounds() {
      return { getWest: () => -122.4, getSouth: () => 47.55, getEast: () => -122.25, getNorth: () => 47.65 };
    }
    getCanvas() {
      return { style: {} } as HTMLCanvasElement;
    }
    fireMoveEnd() {
      for (const cb of this.handlers.moveend ?? []) cb();
    }
  }
  class MockMarker {
    element: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat(ll: [number, number]) {
      this.element.dataset.lnglat = ll.join(",");
      return this;
    }
    addTo() {
      this.element.setAttribute("aria-label", "Map marker");
      this.element.setAttribute("role", "button");
      document.body.appendChild(this.element);
      return this;
    }
    remove() {
      this.element.remove();
    }
  }
  class MockLngLatBounds {
    sw: [number, number];
    ne: [number, number];
    extended: [number, number][] = [];
    constructor(sw: [number, number], ne: [number, number]) {
      this.sw = sw;
      this.ne = ne;
    }
    extend(point: [number, number]) {
      this.extended.push(point);
      return this;
    }
  }
  class MockPopup {
    static last: MockPopup | null = null;
    content: HTMLElement | null = null;
    closeHandlers: Array<() => void> = [];
    constructor() {
      MockPopup.last = this;
    }
    setLngLat() {
      return this;
    }
    setDOMContent(el: HTMLElement) {
      this.content = el;
      return this;
    }
    on(event: string, cb: () => void) {
      if (event === "close") this.closeHandlers.push(cb);
      return this;
    }
    addTo() {
      document.body.appendChild(this.content!);
      return this;
    }
    remove() {
      this.content?.remove();
      for (const cb of this.closeHandlers) cb();
    }
  }
  // maplibre-gl v6 is ESM-only with named exports (`import * as maplibregl`),
  // so the mock exposes them at the top level rather than under `default`.
  return {
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    LngLatBounds: MockLngLatBounds,
    NavigationControl: class {},
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
  };
});

vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));

import * as maplibregl from "maplibre-gl";

import { MapCanvas, iconHtml, markerKindFor, ringsGeoJSON } from "./MapCanvas";
import { placeIdentity } from "../lib/placeIdentity";
import type { DashboardSummary, Place } from "../types";

type MockMapInstance = {
  fireClick: (lat: number, lng: number) => void;
  fireLayerClick: (layerId: string, feature: Record<string, unknown>, lngLat?: { lng: number; lat: number }) => void;
  fireMoveEnd: () => void;
  sources: Map<string, {
    options?: Record<string, unknown>;
    setData: ReturnType<typeof vi.fn>;
    getClusterExpansionZoom: ReturnType<typeof vi.fn>;
  }>;
  layers: Array<Record<string, unknown>>;
  setStyle: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
};
const MockedMap = maplibregl.Map as unknown as {
  last: MockMapInstance | null;
  lastOptions: { style: { sprite: string; sources: { protomaps: { url: string } } } } | null;
};
const MockPopup = (maplibregl as unknown as {
  Popup: { last: { remove: () => void } | null };
}).Popup;

const place: Place = {
  id: "p1",
  display_label: "Home",
  latitude: 47.61,
  longitude: -122.33,
  visit_count: 5,
  total_dwell_minutes: null,
  inferred_place_type: "manual_place",
  sensitivity_class: "normal",
};

// MapWorkspace's ad-hoc synthetic shape: coordinate-key id, adhoc_entry type, always
// in selectedIds — never present in crime_summaries.
const adhoc: Place = {
  ...place,
  id: "47.6300,-122.3500",
  display_label: "500 Pine St",
  latitude: 47.63,
  longitude: -122.35,
  inferred_place_type: "adhoc_entry",
};

function summaryWithCount(): DashboardSummary {
  return {
    totals: { place_count: 1, visit_count: 5, incident_count: 9 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [place],
    crime_summaries: [
      {
        place_cluster_id: "p1",
        radius_m: 250,
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-24",
        offense_category: null,
        offense_subcategory: null,
        nibrs_group: null,
        incident_count: 9,
        nearest_incident_m: null,
        incidents_per_visit: null,
        incidents_per_hour_dwell: null,
      },
    ],
    analysis: { available_radii_m: [250] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  };
}

const noop = () => {};

beforeEach(() => {
  MockedMap.last = null;
  MockedMap.lastOptions = null;
  (MockPopup as { last: unknown }).last = null;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function renderCanvas(over: Partial<Parameters<typeof MapCanvas>[0]> = {}) {
  return render(
    <MapCanvas places={[place]} selectedIds={new Set()} draft={null} addPinMode={false}
      summary={null} radiusM={250} flyTo={null} beats={null} highlightBeats={[]}
      incidentPoints={null} theme="light" onViewportChange={noop} onMapClick={noop} onMarkerClick={noop} {...over} />,
  );
}

describe("markerKindFor", () => {
  it("classifies analyzed, low-data, selected, and default places", () => {
    const s = summaryWithCount();
    expect(markerKindFor(place, new Set(), s, 250)).toBe("analyzed");
    const other: Place = { ...place, id: "p2" };
    expect(markerKindFor(other, new Set(["p2"]), s, 250)).toBe("low");
    expect(markerKindFor(other, new Set(["p2"]), null, 250)).toBe("selected");
    expect(markerKindFor(other, new Set(), null, 250)).toBe("default");
  });

  it("never marks ad-hoc synthetics low, even when the radius has analyzed summaries", () => {
    // summaryWithCount analyzes p1 at 250 m, so the global analyzedAtRadius flag is true —
    // the trap that would otherwise classify a selected-but-unanalyzable synthetic as "low".
    const s = summaryWithCount();
    expect(markerKindFor(adhoc, new Set([adhoc.id]), s, 250)).toBe("selected");
    expect(markerKindFor(adhoc, new Set(), s, 250)).toBe("default");
  });
});

describe("iconHtml", () => {
  it("escapes selected place labels before injecting marker HTML", () => {
    const html = iconHtml("selected", { label: '<img src=x onerror="alert(1)">' });
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
  });
});

describe("iconHtml with identity", () => {
  it("uses the identity color token and letter glyph", () => {
    const html = iconHtml("selected", { label: "Cafe", identity: placeIdentity(0) });
    expect(html).toContain("var(--id-a)");
    expect(html).toContain(">A</text>");
    expect(html).toContain("mc-pin-halo"); // kind extras preserved
  });

  it("keeps the count badge for analyzed identity pins", () => {
    const html = iconHtml("analyzed", { count: 7, identity: placeIdentity(1) });
    expect(html).toContain("var(--id-b)");
    expect(html).toContain(">B</text>");
    expect(html).toContain("mc-pin-badge");
  });

  it("renders legacy colors when no identity is given", () => {
    expect(iconHtml("selected", { label: "x" })).toContain("var(--accent)");
    expect(iconHtml("default", {})).toContain("#3A3F46");
  });
});

describe("ringsGeoJSON", () => {
  it("emits one polygon per analyzed/low place with the kind tagged", () => {
    const fc = ringsGeoJSON([place], new Set(), summaryWithCount(), 250);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.kind).toBe("analyzed");
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("emits nothing for unanalyzed places", () => {
    const fc = ringsGeoJSON([place], new Set(), null, 250);
    expect(fc.features).toHaveLength(0);
  });

  it("never rings ad-hoc synthetics in a mixed session", () => {
    // Saved analyzed place + selected ad-hoc synthetic under the same summary: only the
    // saved place rings — synthetics have no persisted summary to ring around.
    const fc = ringsGeoJSON([place, adhoc], new Set([adhoc.id]), summaryWithCount(), 250);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.kind).toBe("analyzed");
  });
});

describe("MapCanvas", () => {
  it("renders one marker element per place and reports clicks by id", async () => {
    const onMarkerClick = vi.fn();
    renderCanvas({ onMarkerClick });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(1));
    (document.body.querySelector(".mc-pin-main") as HTMLElement).click();
    expect(onMarkerClick).toHaveBeenCalledWith("p1");
  });

  it("renders a draft marker in addition to place markers", async () => {
    renderCanvas({
      draft: { latitude: 47.6, longitude: -122.3, display_label: "", visit_count: 1, sensitivity_class: "normal", source: "map" },
      addPinMode: true,
    });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(2));
  });

  it("shows the fallback notice when the tile artifact is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    renderCanvas();
    const notice = await screen.findByText(/basemap tiles are unavailable right now/i);
    expect(notice).toBeInTheDocument();
    // The notice is user-facing copy, not developer instructions — no make targets in the UI.
    expect(notice.textContent).not.toMatch(/make /);
  });

  it("skips places without coordinates", async () => {
    renderCanvas({ places: [{ ...place, latitude: null, longitude: null }] });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(0));
  });

  it("reports map background clicks through onMapClick", async () => {
    const onMapClick = vi.fn();
    renderCanvas({ onMapClick });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    MockedMap.last!.fireClick(47.6, -122.3);
    expect(onMapClick).toHaveBeenCalledWith({ lat: 47.6, lng: -122.3 });
  });

  it("pushes ring polygons into the mc-rings source", async () => {
    renderCanvas({ summary: summaryWithCount() });
    await waitFor(() =>
      expect(MockedMap.last?.sources.get("mc-rings")?.setData).toHaveBeenCalled(),
    );
    const setData = MockedMap.last!.sources.get("mc-rings")!.setData;
    const data = setData.mock.calls.at(-1)?.[0] as ReturnType<typeof ringsGeoJSON>;
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.kind).toBe("analyzed");
  });

  it("recreates markers when the selection changes", async () => {
    const view = renderCanvas();
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(1));
    expect((document.body.querySelector(".mc-pin-icon") as HTMLElement).innerHTML).not.toContain("mc-pin-tag");
    view.rerender(
      <MapCanvas places={[place]} selectedIds={new Set(["p1"])} draft={null} addPinMode={false}
        summary={null} radiusM={250} flyTo={null} beats={null} highlightBeats={[]}
        incidentPoints={null} theme="light" onViewportChange={noop} onMapClick={noop} onMarkerClick={noop} />,
    );
    await waitFor(() => {
      const el = document.body.querySelector(".mc-pin-icon") as HTMLElement;
      expect(el.innerHTML).toContain("mc-pin-tag");
    });
  });
});

describe("presence badges", () => {
  it("renders a presence badge only for places in badgedPlaceIds", async () => {
    renderCanvas({ badgedPlaceIds: new Set(["p1"]) });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(1));
    const badge = document.body.querySelector(".mc-pin-presence");
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("aria-label", "Analyzed — view context");
    expect(badge?.parentElement).not.toHaveAttribute("role", "button");
    expect(badge?.parentElement?.querySelector(".mc-pin-main")).not.toContainElement(badge as HTMLElement);
  });

  it("renders no presence badge for a place outside badgedPlaceIds", async () => {
    renderCanvas({ badgedPlaceIds: new Set() });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(1));
    expect(document.body.querySelector(".mc-pin-presence")).toBeNull();
  });

  it("clicking the badge calls onBadgeClick, not onMarkerClick", async () => {
    const onBadgeClick = vi.fn();
    const onMarkerClick = vi.fn();
    renderCanvas({ badgedPlaceIds: new Set(["p1"]), onBadgeClick, onMarkerClick });
    await waitFor(() => expect(document.body.querySelector(".mc-pin-presence")).not.toBeNull());
    (document.body.querySelector(".mc-pin-presence") as HTMLElement).click();
    expect(onBadgeClick).toHaveBeenCalledWith("p1");
    expect(onMarkerClick).not.toHaveBeenCalled();
  });

  it("keeps badge keyboard activation separate from its sibling marker button", async () => {
    const onBadgeClick = vi.fn();
    const onMarkerClick = vi.fn();
    renderCanvas({ badgedPlaceIds: new Set(["p1"]), onBadgeClick, onMarkerClick });
    await waitFor(() => expect(document.body.querySelector(".mc-pin-presence")).not.toBeNull());
    const badge = document.body.querySelector(".mc-pin-presence") as HTMLElement;
    badge.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    badge.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onMarkerClick).not.toHaveBeenCalled();
    badge.click();
    expect(onBadgeClick).toHaveBeenCalledTimes(1);
    expect(onBadgeClick).toHaveBeenCalledWith("p1");
  });
});

describe("fitTo", () => {
  it("fits bounds to the given points with the exact padding", async () => {
    renderCanvas({
      fitTo: {
        points: [{ lat: 47.6, lng: -122.3 }, { lat: 47.65, lng: -122.25 }],
        padding: { top: 80, left: 40, bottom: 40, right: 440 },
      },
    });
    await waitFor(() => expect(MockedMap.last?.fitBounds).toHaveBeenCalled());
    const [bounds, options] = MockedMap.last!.fitBounds.mock.calls.at(-1)! as [
      { sw: [number, number]; ne: [number, number]; extended: [number, number][] },
      { padding: unknown; maxZoom: number; duration: number },
    ];
    expect(bounds.sw).toEqual([-122.3, 47.6]);
    expect(bounds.ne).toEqual([-122.3, 47.6]);
    expect(bounds.extended).toEqual([[-122.3, 47.6], [-122.25, 47.65]]);
    expect(options).toEqual({ padding: { top: 80, left: 40, bottom: 40, right: 440 }, maxZoom: 16, duration: 600 });
  });

  it("still fits bounds for a single-point fitTo, with maxZoom capped", async () => {
    renderCanvas({
      fitTo: { points: [{ lat: 47.6, lng: -122.3 }], padding: { top: 80, left: 40, bottom: 40, right: 440 } },
    });
    await waitFor(() => expect(MockedMap.last?.fitBounds).toHaveBeenCalled());
    const [bounds, options] = MockedMap.last!.fitBounds.mock.calls.at(-1)! as [
      { sw: [number, number]; ne: [number, number]; extended: [number, number][] },
      { padding: unknown; maxZoom: number; duration: number },
    ];
    expect(bounds.sw).toEqual([-122.3, 47.6]);
    expect(bounds.extended).toEqual([[-122.3, 47.6]]);
    expect(options.maxZoom).toBe(16);
  });
});

const BEATS_FC = {
  type: "FeatureCollection" as const,
  features: [
    { type: "Feature" as const, properties: { beat: "M3" }, geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  ],
};

const POINTS_FC = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { id: "inc-1", offense_category: "PROPERTY", offense_subcategory: "THEFT", occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST", record_count: 1, item_label: "reported incidents" },
      geometry: { type: "Point" as const, coordinates: [-122.33, 47.61] as [number, number] },
    },
  ],
};

describe("beat + incident layers", () => {
  it("feeds beat polygons into the mc-beats source and highlights analyzed beats", async () => {
    renderCanvas({ beats: BEATS_FC, highlightBeats: ["M3"] });
    await waitFor(() => {
      const source = MockedMap.last!.sources.get("mc-beats");
      expect(source!.setData).toHaveBeenCalledWith(BEATS_FC);
    });
    const highlight = MockedMap.last!.layers.find((l) => l.id === "mc-beat-highlight");
    expect(highlight?.filter).toEqual(["in", ["get", "beat"], ["literal", ["M3"]]]);
  });

  it("creates the incident source clustered and feeds it points", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => {
      const source = MockedMap.last!.sources.get("mc-incidents");
      expect(source!.options).toMatchObject({
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 40,
        clusterProperties: { record_count: ["+", ["get", "record_count"]] },
      });
      expect(source!.setData).toHaveBeenCalledWith(POINTS_FC);
    });
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-cluster")).toMatchObject({
      paint: {
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.42, 12, 0.6],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["sqrt", ["min", ["get", "record_count"], 500]],
          1, 5, 3.1622776602, 7, 10, 12, 22.360679775, 18,
        ],
      },
    });
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-cluster-count")).toMatchObject({
      minzoom: 12,
      filter: ["all", ["has", "point_count"], [">=", ["get", "record_count"], 25]],
      layout: { "text-padding": 4, "text-allow-overlap": false },
    });
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-dot")).toMatchObject({
      minzoom: 16,
      paint: {
        "circle-opacity": 0.72,
        "circle-radius": ["step", ["get", "record_count"], 4.5, 2, 5.5, 10, 7, 100, 8.5],
      },
    });
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-selected")).toMatchObject({
      minzoom: 16,
    });
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-stack-count")).toMatchObject({
      minzoom: 16,
      filter: ["all", ["!", ["has", "point_count"]], [">=", ["get", "record_count"], 10]],
      layout: { "text-allow-overlap": false },
    });
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-hit")).toMatchObject({
      minzoom: 16,
      paint: { "circle-opacity": 0, "circle-radius": 13 },
    });
  });

  it("opens an XSS-safe popup card on dot click", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    MockedMap.last!.fireLayerClick("mc-incident-hit", {
      properties: { id: "inc-1", offense_subcategory: '<img src=x onerror="a">', offense_category: "PROPERTY", occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST" },
    });
    const card = document.body.querySelector(".mc-incident-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('<img'); // title-cased but rendered as TEXT, tag intact
    expect(card!.querySelector("img")).toBeNull(); // never parsed as HTML
    expect(card!.textContent).toContain("100 block of Pine St"); // formatted via formatIncidentAddress
  });

  it("explains a shared-coordinate stack without presenting representative offense metadata", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    MockedMap.last!.fireLayerClick("mc-incident-hit", {
      properties: {
        id: "inc-stack-1",
        record_count: 27,
        item_label: "reported incidents",
        offense_subcategory: "THEFT",
        occurred_at: "2025-06-03T12:00:00Z",
        block_address: "1XX BLOCK OF PINE ST",
      },
    });
    const card = document.body.querySelector(".mc-incident-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("27 reported incidents");
    expect(card!.textContent).toContain("These records are mapped to the same block.");
    expect(card!.textContent).toContain("Latest record: 2025-06-03");
    expect(card!.textContent).not.toContain("Theft");
    expect(card!.textContent).not.toContain("Pine");
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-selected")?.filter).toEqual([
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "id"], "inc-stack-1"],
    ]);
    MockPopup.last!.remove();
    expect(MockedMap.last!.layers.find((layer) => layer.id === "mc-incident-selected")?.filter).toEqual([
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "id"], "__no_selected_incident__"],
    ]);
  });

  it("discloses an aggregate count while expanding a selected map cluster", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    MockedMap.last!.fireLayerClick("mc-incident-cluster", {
      properties: { cluster_id: 7, record_count: 125 },
      geometry: { type: "Point", coordinates: [-122.33, 47.61] },
    });
    const card = document.body.querySelector(".mc-incident-card");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("125 matching records");
    expect(card).toHaveTextContent("Grouped in this map view. Zooming in shows their block locations.");
    const source = MockedMap.last!.sources.get("mc-incidents")!;
    expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(7);
    await waitFor(() => expect(MockedMap.last!.easeTo).toHaveBeenCalledWith({
      center: [-122.33, 47.61],
      zoom: 13,
    }));
  });

  it("emits viewport bounds on moveend and once after load", async () => {
    const onViewportChange = vi.fn();
    renderCanvas({ onViewportChange });
    await waitFor(() => expect(onViewportChange).toHaveBeenCalled());
    onViewportChange.mockClear();
    MockedMap.last!.fireMoveEnd();
    expect(onViewportChange).toHaveBeenCalledWith({ west: -122.4, south: 47.55, east: -122.25, north: 47.65 });
  });
});

describe("themed map", () => {
  it("re-registers data layers and re-feeds data after a theme swap", async () => {
    const view = renderCanvas({ incidentPoints: POINTS_FC, beats: BEATS_FC, theme: "light" });
    await waitFor(() => expect(MockedMap.last!.sources.get("mc-incidents")).toBeTruthy());
    view.rerender(
      <MapCanvas places={[place]} selectedIds={new Set()} draft={null} addPinMode={false}
        summary={null} radiusM={250} flyTo={null} beats={BEATS_FC} highlightBeats={[]}
        incidentPoints={POINTS_FC} theme="dark" onViewportChange={noop} onMapClick={noop} onMarkerClick={noop} />,
    );
    await waitFor(() => {
      expect(MockedMap.last!.setStyle).toHaveBeenCalledTimes(1);
      const incidents = MockedMap.last!.sources.get("mc-incidents");
      expect(incidents).toBeTruthy();
      expect(incidents!.setData).toHaveBeenCalledWith(POINTS_FC);
      const beats = MockedMap.last!.sources.get("mc-beats");
      expect(beats!.setData).toHaveBeenCalledWith(BEATS_FC);
    });
    // The rings re-register with the dark accent hex after the swap (canvas paint can't
    // read CSS vars, so the theme picks the fixed color at registration).
    const ringLine = MockedMap.last!.layers.find((l) => l.id === "mc-ring-line");
    expect((ringLine?.paint as Record<string, unknown>)["line-color"]).toBe("#3FBF8F");
    const selectedIncident = MockedMap.last!.layers.find((l) => l.id === "mc-incident-selected");
    expect((selectedIncident?.paint as Record<string, unknown>)["circle-stroke-color"]).toBe("#3FBF8F");
  });

  // Regression: under maplibre-gl v6 the default (diffing) setStyle applies a theme swap in
  // place and leaves the canvas one toggle behind — the map keeps painting the previous
  // style until the next setStyle. v5 rebuilt instead, because it rejected setSprite/
  // setGlyphs as unimplemented diff operations. Pin the explicit rebuild.
  it("swaps the basemap with a full rebuild, not an in-place style diff", async () => {
    const view = renderCanvas({ theme: "light" });
    await waitFor(() => expect(MockedMap.last!.sources.get("mc-rings")).toBeTruthy());
    view.rerender(
      <MapCanvas places={[place]} selectedIds={new Set()} draft={null} addPinMode={false}
        summary={null} radiusM={250} flyTo={null} beats={null} highlightBeats={[]}
        incidentPoints={null} theme="dark" onViewportChange={noop} onMapClick={noop} onMarkerClick={noop} />,
    );
    await waitFor(() => expect(MockedMap.last!.setStyle).toHaveBeenCalledTimes(1));
    const [style, options] = MockedMap.last!.setStyle.mock.calls[0]!;
    expect(options).toEqual({ diff: false });
    expect((style as { sprite: string }).sprite).toMatch(/\/dark$/);
  });

  it("passes the theme to the style builder", async () => {
    renderCanvas({ theme: "dark" });
    await waitFor(() => expect(MockedMap.lastOptions).not.toBeNull());
    expect(MockedMap.lastOptions!.style.sources.protomaps.url).toContain("pmtiles://");
    expect(MockedMap.lastOptions!.style.sprite).toMatch(/\/dark$/);
  });
});
