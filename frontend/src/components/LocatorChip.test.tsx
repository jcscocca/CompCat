// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { McppFeatureCollection } from "../types";
import { placeIdentity } from "../lib/placeIdentity";
import { collectionBox, mosaicPath } from "../lib/locatorGeometry";
import { LocatorChip } from "./LocatorChip";

const FC: McppFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { mcpp: "TEST HILL" },
      geometry: { type: "Polygon", coordinates: [[[-122.4, 47.5], [-122.3, 47.5], [-122.3, 47.6], [-122.4, 47.6], [-122.4, 47.5]]] },
    },
    {
      type: "Feature",
      properties: { mcpp: "OTHERTOWN" },
      geometry: { type: "Polygon", coordinates: [[[-122.3, 47.6], [-122.2, 47.6], [-122.2, 47.7], [-122.3, 47.7], [-122.3, 47.6]]] },
    },
  ],
};

const box = collectionBox(FC)!;
const locator = { polygons: FC, box, mosaic: mosaicPath(FC, box) };

afterEach(cleanup);

describe("LocatorChip", () => {
  it("highlights the place's neighborhood (display label round-trips to canonical name)", () => {
    render(
      <LocatorChip locator={locator} latitude={47.55} longitude={-122.35} mcppLabel="Test Hill" identity={placeIdentity(0)} />,
    );
    expect(screen.getByTestId("locator-highlight")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A is in Test Hill" })).toBeInTheDocument();
  });

  it("renders mosaic + pin without a highlight when the place has no neighborhood", () => {
    render(
      <LocatorChip locator={locator} latitude={47.55} longitude={-122.35} mcppLabel={null} identity={placeIdentity(1)} />,
    );
    expect(screen.queryByTestId("locator-highlight")).toBeNull();
    expect(screen.getByRole("img", { name: "Location of B in Seattle" })).toBeInTheDocument();
  });

  it("renders a button and fires onActivate when clicked, with the chip carrying no separate a11y label", () => {
    const onActivate = vi.fn();
    render(
      <LocatorChip
        locator={locator}
        latitude={47.55}
        longitude={-122.35}
        mcppLabel="Test Hill"
        identity={placeIdentity(0)}
        onActivate={onActivate}
      />,
    );
    const button = screen.getByRole("button", { name: "Fly the map to A in Test Hill" });
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("locator-chip")).toHaveAttribute("aria-hidden", "true");
  });

  it("stays a plain role=img chip (no button) when onActivate is not given", () => {
    render(
      <LocatorChip locator={locator} latitude={47.55} longitude={-122.35} mcppLabel="Test Hill" identity={placeIdentity(0)} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A is in Test Hill" })).toBeInTheDocument();
  });
});
