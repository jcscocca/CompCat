// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddressLookup } from "./AddressLookup";
import type { GeocodingProvider } from "../lib/geocoding";
import type { GeocodeResult } from "../types";

const result: GeocodeResult = { label: "123 Main St, Seattle", latitude: 47.61, longitude: -122.34, source: "test" };

function stubProvider(results: GeocodeResult[] = [result]): GeocodingProvider {
  return { search: vi.fn().mockResolvedValue(results) };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe("AddressLookup", () => {
  it("renders the look-up framing", () => {
    render(<AddressLookup provider={stubProvider()} onSelect={vi.fn()} onManual={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /look up an address/i })).toBeInTheDocument();
  });

  it("calls onManual when 'Add places manually' is clicked", () => {
    const onManual = vi.fn();
    render(<AddressLookup provider={stubProvider()} onSelect={vi.fn()} onManual={onManual} />);
    fireEvent.click(screen.getByRole("button", { name: /add places manually/i }));
    expect(onManual).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect with the chosen address", async () => {
    const onSelect = vi.fn();
    render(<AddressLookup provider={stubProvider()} onSelect={onSelect} onManual={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/search an address/i), { target: { value: "123 Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("123 Main St, Seattle"));
    expect(onSelect).toHaveBeenCalledWith(result);
  });
});
