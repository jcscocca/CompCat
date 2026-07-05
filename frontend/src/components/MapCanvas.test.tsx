// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// maplibre-gl needs WebGL; mock the whole module. Markers append their element to
// document.body so testing-library queries can see them.
vi.mock("maplibre-gl", () => {
  class MockMap {
    handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    on(event: string, cb: (arg?: unknown) => void) {
      (this.handlers[event] ??= []).push(cb);
      if (event === "load") cb();
      return this;
    }
    once(event: string, cb: (arg?: unknown) => void) {
      return this.on(event, cb);
    }
    addSource() {}
    getSource() {
      return { setData: vi.fn() };
    }
    addLayer() {}
    addControl() {}
    getZoom() {
      return 12;
    }
    flyTo = vi.fn();
    remove() {}
    fireClick(lat: number, lng: number) {
      for (const cb of this.handlers.click ?? []) cb({ lngLat: { lat, lng } });
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
  return { default: { Map: MockMap, Marker: MockMarker, addProtocol: vi.fn() } };
});

vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));

import { MapCanvas, iconHtml, markerKindFor, ringsGeoJSON } from "./MapCanvas";
import type { DashboardSummary, Place } from "../types";

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
      summary={null} radiusM={250} flyTo={null} onMapClick={noop} onMarkerClick={noop} {...over} />,
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
});
