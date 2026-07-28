// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IncidentDetailsSection } from "./IncidentDetailsSection";
import { incidentNoun } from "../lib/layerCopy";
import type { IncidentDetail, IncidentDetailsResponse } from "../types";

afterEach(cleanup);

function incident(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    place_id: "p1", place_label: "Home", incident_id: "i1", external_incident_id: null,
    report_number: "R-1", occurred_at: "2026-03-02T14:30:00", reported_at: null,
    offense_category: "PROPERTY", offense_subcategory: null, nibrs_group: "A",
    block_address: "1 MAIN ST", distance_m: 40, ...overrides,
  };
}

function details(...incidents: IncidentDetail[]): IncidentDetailsResponse {
  return { incidents, returned_count: incidents.length, total_count: incidents.length, limit: 200, radius_m: 250 };
}

const noun = incidentNoun("reported");

describe("IncidentDetailsSection NIBRS gloss", () => {
  it("wraps the NIBRS acronym in an abbr with a plain-language title (table layout)", () => {
    const { container } = render(
      <IncidentDetailsSection details={details(incident())} noun={noun} layout="table" showCategory subcategoryHeader="Subcategory" />,
    );
    const abbr = container.querySelector("abbr");
    expect(abbr).toHaveTextContent("NIBRS");
    expect(abbr).toHaveAttribute("title", expect.stringContaining("National Incident-Based Reporting System"));
    // The group letter stays outside the abbr, in the same cell.
    expect(abbr!.parentElement).toHaveTextContent("NIBRS A");
  });

  it("glosses NIBRS in the card layout too", () => {
    const { container } = render(
      <IncidentDetailsSection details={details(incident())} noun={noun} layout="cards" showCategory subcategoryHeader="Subcategory" />,
    );
    expect(container.querySelector("abbr")).toHaveAttribute(
      "title",
      expect.stringContaining("National Incident-Based Reporting System"),
    );
  });

  it("leaves rows without a NIBRS group unglossed", () => {
    const { container } = render(
      <IncidentDetailsSection details={details(incident({ nibrs_group: null }))} noun={noun} layout="table" showCategory subcategoryHeader="Subcategory" />,
    );
    expect(container.querySelector("abbr")).toBeNull();
    expect(screen.getByText("All reported")).toBeInTheDocument();
  });
});
