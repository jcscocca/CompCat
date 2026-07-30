// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchPill } from "./SearchPill";
import type { GeocodeResult } from "../types";

const RESULT: GeocodeResult = { label: "8800 Delridge Way SW", latitude: 47.52, longitude: -122.36, source: "nominatim" };
const search = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset().mockResolvedValue([RESULT]);
  localStorage.clear();
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  cleanup();
});

describe("SearchPill", () => {
  it("searches after the debounce and reports the selected result", async () => {
    const onSelect = vi.fn();
    render(<SearchPill search={search} onSelect={onSelect} addPinMode={false} onToggleAddPin={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: /search address/i }), { target: { value: "8800 Del" } });
    // Fake timers freeze findBy*'s waitFor polling; act + advancing past the debounce flushes
    // the search promise and its state update, so the option is in the DOM synchronously.
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    fireEvent.click(screen.getByRole("option", { name: /8800 Delridge/i }));
    expect(onSelect).toHaveBeenCalledWith(RESULT);
  });

  it("carries a stable id for external focus requests", () => {
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode={false} onToggleAddPin={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: /search address/i })).toHaveAttribute("id", "mc-search-input");
  });

  // Typing an address and pressing Enter is the first thing anyone tries; before this the
  // key did nothing and the only way to pick a suggestion was the mouse.
  it("selects the sole suggestion on Enter", async () => {
    const onSelect = vi.fn();
    render(<SearchPill search={search} onSelect={onSelect} addPinMode={false} onToggleAddPin={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /search address/i });
    fireEvent.change(input, { target: { value: "8800 Del" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(RESULT);
  });

  it("selects the highlighted suggestion on Enter", async () => {
    const onSelect = vi.fn();
    const second: GeocodeResult = { label: "8800 Delridge Way S", latitude: 47.53, longitude: -122.37, source: "nominatim" };
    search.mockResolvedValue([RESULT, second]);
    render(<SearchPill search={search} onSelect={onSelect} addPinMode={false} onToggleAddPin={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /search address/i });
    fireEvent.change(input, { target: { value: "8800 Del" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(second);
  });

  it("tracks the active option with aria-activedescendant and aria-selected", async () => {
    const second: GeocodeResult = { label: "8800 Delridge Way S", latitude: 47.53, longitude: -122.37, source: "nominatim" };
    search.mockResolvedValue([RESULT, second]);
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode={false} onToggleAddPin={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /search address/i });
    fireEvent.change(input, { target: { value: "8800 Del" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    // ArrowUp from the first option wraps to the last.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("closes the list on Escape without selecting", async () => {
    const onSelect = vi.fn();
    render(<SearchPill search={search} onSelect={onSelect} addPinMode={false} onToggleAddPin={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /search address/i });
    fireEvent.change(input, { target: { value: "8800 Del" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole("option", { name: /8800 Delridge/i })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes the list on an outside pointer press", async () => {
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode={false} onToggleAddPin={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /search address/i });
    fireEvent.change(input, { target: { value: "8800 Del" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole("option", { name: /8800 Delridge/i })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("keeps the list open when focus moves to an option", async () => {
    const onSelect = vi.fn();
    render(<SearchPill search={search} onSelect={onSelect} addPinMode={false} onToggleAddPin={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: /search address/i });
    fireEvent.change(input, { target: { value: "8800 Del" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    const option = screen.getByRole("option", { name: /8800 Delridge/i });
    fireEvent.blur(input, { relatedTarget: option });
    expect(screen.queryByRole("option")).toBeInTheDocument();
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(RESULT);
  });

  it("arms pin-drop mode via the pin button", () => {
    const onToggleAddPin = vi.fn();
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode={false} onToggleAddPin={onToggleAddPin} />);
    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    expect(onToggleAddPin).toHaveBeenCalled();
    // pressed state reflects armed mode
    cleanup();
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode onToggleAddPin={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Drop a pin on the map" })).toHaveAttribute("aria-pressed", "true");
  });
});
