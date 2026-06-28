// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, className }: any) => (
    <div data-testid="map" className={className}>{children}</div>
  ),
  TileLayer: ({ url }: any) => <div data-testid="tile" data-url={url} />,
  Marker: ({ position, eventHandlers, icon }: any) => (
    <button
      data-testid="marker"
      data-pos={(position as number[]).join(",")}
      data-icon-html={icon?.options?.html ?? ""}
      onClick={eventHandlers?.click}
    />
  ),
  Circle: ({ radius }: any) => <div data-testid="ring" data-radius={radius} />,
  useMap: () => ({ flyTo: vi.fn(), getZoom: () => 12 }),
  useMapEvents: () => null,
}));

import { MapCanvas } from "./MapCanvas";
import { defaultTileConfig } from "../lib/mapTiles";
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

afterEach(cleanup);
const noop = () => {};

describe("MapCanvas", () => {
  it("renders the configured tile layer", () => {
    render(
      <MapCanvas places={[]} selectedIds={new Set()} draft={null} addPinMode={false} summary={null}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={noop} />,
    );
    expect(screen.getByTestId("tile")).toHaveAttribute("data-url", defaultTileConfig.url);
  });

  it("renders one marker per place and reports clicks by id", () => {
    const onMarkerClick = vi.fn();
    render(
      <MapCanvas places={[place]} selectedIds={new Set()} draft={null} addPinMode={false} summary={null}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={onMarkerClick} />,
    );
    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(1);
    fireEvent.click(markers[0]);
    expect(onMarkerClick).toHaveBeenCalledWith("p1");
  });

  it("draws a radius ring for analyzed places", () => {
    render(
      <MapCanvas places={[place]} selectedIds={new Set(["p1"])} draft={null} addPinMode={false} summary={summaryWithCount()}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={noop} />,
    );
    expect(screen.getByTestId("ring")).toHaveAttribute("data-radius", "250");
  });

  it("escapes selected place labels before injecting marker HTML", () => {
    const maliciousPlace = {
      ...place,
      display_label: '<img src=x onerror="alert(1)">',
    };

    render(
      <MapCanvas places={[maliciousPlace]} selectedIds={new Set(["p1"])} draft={null} addPinMode={false} summary={null}
        radiusM={250} flyTo={null} tileConfig={defaultTileConfig} onMapClick={noop} onMarkerClick={noop} />,
    );

    const iconHtml = screen.getByTestId("marker").getAttribute("data-icon-html");
    expect(iconHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(iconHtml).not.toContain("<img");
    expect(iconHtml).not.toContain("onerror=\"alert(1)\"");
  });

  it("renders a draft marker in addition to place markers", () => {
    render(
      <MapCanvas
        places={[place]}
        selectedIds={new Set()}
        draft={{ latitude: 47.6, longitude: -122.3, display_label: "", visit_count: 1, sensitivity_class: "normal", source: "map" }}
        addPinMode
        summary={null}
        radiusM={250}
        flyTo={null}
        tileConfig={defaultTileConfig}
        onMapClick={noop}
        onMarkerClick={noop}
      />,
    );
    expect(screen.getAllByTestId("marker")).toHaveLength(2);
  });
});
