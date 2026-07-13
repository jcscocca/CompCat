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
    sources = new Map<string, { options?: Record<string, unknown>; setData: ReturnType<typeof vi.fn> }>();
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
      this.sources.set(id, { options, setData: vi.fn() });
    }
    getSource(id: string) {
      return this.sources.get(id);
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
      document.body.appendChild(this.element);
      return this;
    }
    remove() {
      this.element.remove();
    }
  }
  class MockPopup {
    static last: MockPopup | null = null;
    content: HTMLElement | null = null;
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
    addTo() {
      document.body.appendChild(this.content!);
      return this;
    }
    remove() {
      this.content?.remove();
    }
  }
  return { default: { Map: MockMap, Marker: MockMarker, Popup: MockPopup, NavigationControl: class {}, addProtocol: vi.fn() } };
});

vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));

import maplibregl from "maplibre-gl";

import { MapCanvas, iconHtml, markerKindFor, ringsGeoJSON } from "./MapCanvas";
import { placeIdentity } from "../lib/placeIdentity";
import type { DashboardSummary, Place } from "../types";

type MockMapInstance = {
  fireClick: (lat: number, lng: number) => void;
  fireLayerClick: (layerId: string, feature: Record<string, unknown>, lngLat?: { lng: number; lat: number }) => void;
  fireMoveEnd: () => void;
  sources: Map<string, { options?: Record<string, unknown>; setData: ReturnType<typeof vi.fn> }>;
  layers: Array<Record<string, unknown>>;
  setStyle: ReturnType<typeof vi.fn>;
};
const MockedMap = maplibregl.Map as unknown as {
  last: MockMapInstance | null;
  lastOptions: { style: { sprite: string; sources: { protomaps: { url: string } } } } | null;
};
const MockPopup = (maplibregl as unknown as { Popup: { last: unknown } }).Popup;

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
});

describe("MapCanvas", () => {
  it("renders one marker element per place and reports clicks by id", async () => {
    const onMarkerClick = vi.fn();
    renderCanvas({ onMarkerClick });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(1));
    (document.body.querySelector(".mc-pin-icon") as HTMLElement).click();
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
    expect(await screen.findByText(/basemap tiles unavailable/i)).toBeInTheDocument();
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
      properties: { id: "inc-1", offense_category: "PROPERTY", offense_subcategory: "THEFT", occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST" },
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
      expect(source!.options).toMatchObject({ cluster: true, clusterMaxZoom: 13 });
      expect(source!.setData).toHaveBeenCalledWith(POINTS_FC);
    });
  });

  it("opens an XSS-safe popup card on dot click", async () => {
    renderCanvas({ incidentPoints: POINTS_FC });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    MockedMap.last!.fireLayerClick("mc-incident-dot", {
      properties: { id: "inc-1", offense_subcategory: '<img src=x onerror="a">', offense_category: "PROPERTY", occurred_at: "2025-06-01T12:00:00Z", block_address: "1XX BLOCK OF PINE ST" },
    });
    const card = document.body.querySelector(".mc-incident-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('<img'); // title-cased but rendered as TEXT, tag intact
    expect(card!.querySelector("img")).toBeNull(); // never parsed as HTML
    expect(card!.textContent).toContain("100 block of Pine St"); // formatted via formatIncidentAddress
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
    expect((ringLine?.paint as Record<string, unknown>)["line-color"]).toBe("#4FB3D9");
  });

  it("passes the theme to the style builder", async () => {
    renderCanvas({ theme: "dark" });
    await waitFor(() => expect(MockedMap.lastOptions).not.toBeNull());
    expect(MockedMap.lastOptions!.style.sources.protomaps.url).toContain("pmtiles://");
    expect(MockedMap.lastOptions!.style.sprite).toMatch(/\/dark$/);
  });
});
