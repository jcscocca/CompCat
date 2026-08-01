// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IncidentDisclosure } from "./IncidentDisclosure";

afterEach(cleanup);

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

  it("discloses location-level truncation when the cap bites", () => {
    render(<IncidentDisclosure returnedCount={11000} totalCount={12340} returnedLocationCount={5000} totalLocationCount={6120} unmappableCitywideCount={0} limit={5000} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("12,340 incidents across 6,120 block locations in current map view");
    expect(chip).toHaveTextContent("Map represents 11,000 records at 5,000 block locations with the most recent records. Records mapped to the same block stay grouped.");
  });

  it("uses the active layer noun", () => {
    render(<IncidentDisclosure returnedCount={8} totalCount={8} returnedLocationCount={1} totalLocationCount={1} unmappableCitywideCount={0} limit={5000} itemLabel="911 calls" />);
    expect(screen.getByRole("status")).toHaveTextContent("8 911 calls across 1 block location in current map view");
  });

  it("omits the redaction clause when nothing was redacted", () => {
    render(<IncidentDisclosure returnedCount={10} totalCount={10} returnedLocationCount={4} totalLocationCount={4} unmappableCitywideCount={0} limit={5000} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("redacted");
  });

  it("states an empty viewport without claiming zero locations", () => {
    render(<IncidentDisclosure returnedCount={0} totalCount={0} returnedLocationCount={0} totalLocationCount={0} unmappableCitywideCount={0} limit={5000} itemLabel="arrests" />);
    expect(screen.getByRole("status")).toHaveTextContent("No arrests in current map view");
    expect(screen.getByRole("status")).not.toHaveTextContent("block location");
  });
});
