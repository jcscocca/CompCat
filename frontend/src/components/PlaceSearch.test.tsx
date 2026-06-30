// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaceSearch } from "./PlaceSearch";
import type { GeocodingProvider } from "../lib/geocoding";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function providerReturning(results = [{ label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" }]): GeocodingProvider {
  return {
    search: vi.fn().mockResolvedValue(results),
  };
}

describe("PlaceSearch", () => {
  it("searches on submit and emits the chosen result", async () => {
    const onSelectResult = vi.fn();
    render(<PlaceSearch provider={providerReturning()} onSelectResult={onSelectResult} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "pike place" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const result = await screen.findByText("Pike Place Market, Seattle");
    fireEvent.click(result);
    expect(onSelectResult).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Pike Place Market, Seattle", latitude: 47.6097 }),
    );
  });

  it("shows the shared error message when search fails (status=error)", async () => {
    const provider: GeocodingProvider = { search: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<PlaceSearch provider={provider} onSelectResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Search is unavailable. Drop a pin on the map instead."));
  });

  it("shows the shared empty message when search returns zero results (status=empty)", async () => {
    const provider: GeocodingProvider = { search: vi.fn().mockResolvedValue([]) };
    render(<PlaceSearch provider={provider} onSelectResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "xyzzy" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("No matches. Drop a pin on the map instead.")).toBeInTheDocument());
  });

  it("does not show the recent list when the input is not focused", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);

    expect(screen.queryByRole("list", { name: "Recent searches" })).not.toBeInTheDocument();
  });

  it("shows the recent list when the input is focused and query is empty", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);

    fireEvent.focus(screen.getByLabelText("Search an address or place"));

    expect(screen.getByRole("list", { name: "Recent searches" })).toBeInTheDocument();
    expect(screen.getByText("Pike Place Market, Seattle")).toBeInTheDocument();
  });

  it("hides the recent list once the user starts typing", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);

    fireEvent.focus(screen.getByLabelText("Search an address or place"));
    expect(screen.getByRole("list", { name: "Recent searches" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "pike" } });
    expect(screen.queryByRole("list", { name: "Recent searches" })).not.toBeInTheDocument();
  });

  it("clicking a recent result calls rememberPlace and onSelectResult", () => {
    const pike = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
    localStorage.setItem("waypoint.search.recent", JSON.stringify([pike]));
    const onSelectResult = vi.fn();
    render(<PlaceSearch provider={providerReturning()} onSelectResult={onSelectResult} />);

    fireEvent.focus(screen.getByLabelText("Search an address or place"));
    // Recent items use onMouseDown (fires before the input's blur), so drive mousedown here.
    fireEvent.mouseDown(screen.getByText("Pike Place Market, Seattle"));

    expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ label: "Pike Place Market, Seattle" }));
    // also persists: the recent list in localStorage still contains the entry
    const stored = JSON.parse(localStorage.getItem("waypoint.search.recent") ?? "[]");
    expect(stored[0].label).toBe("Pike Place Market, Seattle");
  });

  it("does not show the recent list when there are no recent places", () => {
    render(<PlaceSearch provider={providerReturning()} onSelectResult={vi.fn()} />);
    fireEvent.focus(screen.getByLabelText("Search an address or place"));
    expect(screen.queryByRole("list", { name: "Recent searches" })).not.toBeInTheDocument();
  });
});
