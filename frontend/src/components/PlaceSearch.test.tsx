// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceSearch } from "./PlaceSearch";
import type { GeocodingProvider } from "../lib/geocoding";

afterEach(cleanup);

function providerReturning(): GeocodingProvider {
  return {
    search: vi.fn().mockResolvedValue([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]),
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

  it("shows a fallback message when search fails", async () => {
    const provider: GeocodingProvider = { search: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<PlaceSearch provider={provider} onSelectResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/drop a pin/i));
  });
});
