// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceChipStrip } from "./PlaceChipStrip";
import { placeIdentity } from "../lib/placeIdentity";
import type { Place } from "../types";

afterEach(cleanup);

function place(id: string, label: string): Place {
  return {
    id,
    display_label: label,
    latitude: 47.6,
    longitude: -122.3,
    visit_count: 1,
    total_dwell_minutes: null,
    inferred_place_type: "manual",
    sensitivity_class: "normal",
  } as Place;
}

const places = [place("p1", "Home"), place("p2", "Work"), place("p3", "Gym")];
// p2 selected first, p1 second — identity letters follow selection order, not list order.
const identity = new Map([
  ["p2", placeIdentity(0)],
  ["p1", placeIdentity(1)],
]);

describe("PlaceChipStrip", () => {
  it("renders a checked chip with its identity letter for selected places", () => {
    render(
      <PlaceChipStrip places={places} identityByPlaceId={identity} onToggle={vi.fn()} onHoverPlace={vi.fn()} onAdd={vi.fn()} />,
    );
    const work = screen.getByRole("checkbox", { name: "Work" });
    expect(work).toHaveAttribute("aria-checked", "true");
    expect(work).toHaveTextContent("A");
    const home = screen.getByRole("checkbox", { name: "Home" });
    expect(home).toHaveTextContent("B");
    expect(screen.getByRole("checkbox", { name: "Gym" })).toHaveAttribute("aria-checked", "false");
  });

  it("toggles on click and reports hover for pin sync", () => {
    const onToggle = vi.fn();
    const onHover = vi.fn();
    render(
      <PlaceChipStrip places={places} identityByPlaceId={identity} onToggle={onToggle} onHoverPlace={onHover} onAdd={vi.fn()} />,
    );
    const gym = screen.getByRole("checkbox", { name: "Gym" });
    fireEvent.click(gym);
    expect(onToggle).toHaveBeenCalledWith("p3");
    fireEvent.mouseEnter(gym);
    expect(onHover).toHaveBeenCalledWith("p3");
    fireEvent.mouseLeave(gym);
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it("has a trailing Add chip that opens the manager", () => {
    const onAdd = vi.fn();
    render(
      <PlaceChipStrip places={places} identityByPlaceId={identity} onToggle={vi.fn()} onHoverPlace={vi.fn()} onAdd={onAdd} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    expect(onAdd).toHaveBeenCalled();
  });
});
