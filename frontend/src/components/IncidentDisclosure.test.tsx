// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IncidentDisclosure } from "./IncidentDisclosure";
import { incidentNoun } from "../lib/layerCopy";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("IncidentDisclosure", () => {
  it("renders nothing before the first fetch", () => {
    render(<IncidentDisclosure returnedCount={0} totalCount={0} returnedLocationCount={0} totalLocationCount={0} unmappableCitywideCount={0} limit={0} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows shown + citywide redacted counts", () => {
    render(<IncidentDisclosure returnedCount={42} totalCount={42} returnedLocationCount={18} totalLocationCount={18} unmappableCitywideCount={6} limit={5000} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("42 incidents across 18 block locations in current map view");
    expect(chip).toHaveTextContent("Records mapped to the same block are shown as counted stacks.");
    expect(chip).toHaveTextContent("+6 citywide with redacted location — in beat stats only.");
  });

  it("keeps the map chrome compact and opens the full explanation on demand", () => {
    render(<IncidentDisclosure returnedCount={42} totalCount={42} returnedLocationCount={18} totalLocationCount={18} unmappableCitywideCount={6} limit={5000} />);

    const toggle = screen.getByRole("button", { name: /42 incidents · 18 blocks\. show map count details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Map count details" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "Map count details" });
    expect(details).toHaveTextContent("42 incidents across 18 block locations in current map view");
    expect(details).toHaveTextContent("Records mapped to the same block are shown as counted stacks.");
    expect(details).toHaveTextContent("+6 citywide with redacted location — in beat stats only.");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Map count details" })).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("discloses location-level truncation when the cap bites", () => {
    render(<IncidentDisclosure returnedCount={11000} totalCount={12340} returnedLocationCount={5000} totalLocationCount={6120} unmappableCitywideCount={0} limit={5000} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("12,340 incidents across 6,120 block locations in current map view");
    expect(chip).toHaveTextContent("Map represents 11,000 records at 5,000 block locations with the most recent records. Records mapped to the same block stay grouped.");
  });

  it("uses the active layer noun", () => {
    render(<IncidentDisclosure returnedCount={8} totalCount={8} returnedLocationCount={1} totalLocationCount={1} unmappableCitywideCount={0} limit={5000} itemNoun={incidentNoun("calls")} />);
    expect(screen.getByRole("status")).toHaveTextContent("8 911 calls across 1 block location in current map view");
  });

  it.each([
    ["reported", "1 reported incident across 1 block location in current map view"],
    ["arrests", "1 arrest across 1 block location in current map view"],
    ["calls", "1 911 call across 1 block location in current map view"],
  ] as const)("uses the singular %s noun for a one-record viewport", (layer, expected) => {
    render(<IncidentDisclosure returnedCount={1} totalCount={1} returnedLocationCount={1} totalLocationCount={1} unmappableCitywideCount={0} limit={5000} itemNoun={incidentNoun(layer)} />);
    expect(screen.getByRole("status")).toHaveTextContent(expected);
  });

  it("omits the redaction clause when nothing was redacted", () => {
    render(<IncidentDisclosure returnedCount={10} totalCount={10} returnedLocationCount={4} totalLocationCount={4} unmappableCitywideCount={0} limit={5000} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("redacted");
  });

  it("states an empty viewport without claiming zero locations", () => {
    render(<IncidentDisclosure returnedCount={0} totalCount={0} returnedLocationCount={0} totalLocationCount={0} unmappableCitywideCount={0} limit={5000} itemNoun={incidentNoun("arrests")} />);
    expect(screen.getByRole("status")).toHaveTextContent("No arrests in current map view");
    expect(screen.getByRole("status")).not.toHaveTextContent("block location");
  });

  it("does not flash refresh state for work that finishes before 400 ms", () => {
    vi.useFakeTimers();
    const view = render(<IncidentDisclosure returnedCount={10} totalCount={10} returnedLocationCount={4} totalLocationCount={4} unmappableCitywideCount={0} limit={5000} refreshing />);
    const disclosure = view.container.querySelector(".mc-disclosure");
    expect(screen.queryByText("Updating…")).toBeNull();
    expect(disclosure).not.toHaveAttribute("aria-busy");

    act(() => vi.advanceTimersByTime(399));
    view.rerender(<IncidentDisclosure returnedCount={10} totalCount={10} returnedLocationCount={4} totalLocationCount={4} unmappableCitywideCount={0} limit={5000} refreshing={false} />);
    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByText("Updating…")).toBeNull();
    expect(disclosure).not.toHaveAttribute("aria-busy");
  });

  it("shows matching visual and accessibility state after a slow refresh", () => {
    vi.useFakeTimers();
    const view = render(<IncidentDisclosure returnedCount={10} totalCount={10} returnedLocationCount={4} totalLocationCount={4} unmappableCitywideCount={0} limit={5000} refreshing />);
    act(() => vi.advanceTimersByTime(400));

    expect(screen.getByText("Updating…")).toBeInTheDocument();
    expect(view.container.querySelector(".mc-disclosure")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /updating map data/i })).toBeInTheDocument();
  });

  it("keeps a failed refresh labeled as the previous view", () => {
    render(<IncidentDisclosure returnedCount={10} totalCount={10} returnedLocationCount={4} totalLocationCount={4} unmappableCitywideCount={0} limit={5000} stale />);
    expect(screen.getByText("Previous view")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /previous map view; update failed/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: "Map count details" })).toHaveTextContent(
      "Map data could not update; these counts reflect the previous map view.",
    );
  });
});
