// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceChipStrip } from "./PlaceChipStrip";
import { placeIdentity } from "../lib/placeIdentity";
import { keyOf, type AddressEntry } from "../lib/useAddressList";
import type { Place } from "../types";

afterEach(cleanup);

const entries: AddressEntry[] = [
  { latitude: 47.6, longitude: -122.3, label: "Home", savedPlaceId: "p1" },
  { latitude: 47.61, longitude: -122.31, label: "Downtown test" },
];
const places: Place[] = [{
  id: "p1", display_label: "Home", latitude: 47.6, longitude: -122.3, visit_count: 1,
  total_dwell_minutes: null, inferred_place_type: "manual", sensitivity_class: "normal",
}];
const identity = new Map([
  ["p1", placeIdentity(0)],
  [keyOf(entries[1]), placeIdentity(1)],
]);

function setup() {
  const handlers = { onToggle: vi.fn(), onFocus: vi.fn(), onHoverPlace: vi.fn(), onRemove: vi.fn(), onSave: vi.fn(), onAdd: vi.fn() };
  render(<PlaceChipStrip places={places} entries={entries} identityByPlaceId={identity} {...handlers} />);
  return handlers;
}

describe("PlaceChipStrip", () => {
  it("renders only the active scope and marks ad-hoc locations unsaved", () => {
    setup();
    expect(screen.getByRole("group", { name: "Locations" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Home" })).toHaveTextContent("A");
    expect(screen.getByRole("button", { name: "Show Downtown test on map" })).toHaveTextContent("Unsaved");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("focuses, saves, and removes without nested interactive controls", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: "Show Downtown test on map" }));
    expect(handlers.onFocus).toHaveBeenCalledWith(entries[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(handlers.onSave).toHaveBeenCalledWith(entries[1]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Downtown test from analysis" }));
    expect(handlers.onRemove).toHaveBeenCalledWith(1);
  });

  it("has a trailing Add chip that opens the manager", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    expect(handlers.onAdd).toHaveBeenCalled();
  });
});
