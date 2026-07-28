import { describe, expect, it } from "vitest";

import { assertValidPlaceCreate, placeCreateViolations } from "./placeCreateContract";
import type { PlaceCreate } from "../types";

const valid: PlaceCreate = {
  display_label: "123 Main St",
  latitude: 47.61,
  longitude: -122.34,
  visit_count: 1,
  sensitivity_class: "normal",
};

describe("POST /places contract", () => {
  it("accepts the payload shape the UI sends", () => {
    expect(placeCreateViolations(valid)).toEqual([]);
    expect(() => assertValidPlaceCreate(valid)).not.toThrow();
  });

  // The regression this fixture exists for: the workspace's Save-a-searched-address path
  // sent visit_count 0, which pydantic (ge=1) rejects with a 422.
  it("rejects visit_count 0 — the backend requires ge=1", () => {
    const violations = placeCreateViolations({ ...valid, visit_count: 0 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/visit_count/);
    expect(() => assertValidPlaceCreate({ ...valid, visit_count: 0 })).toThrow(/422/);
  });

  it("allows an omitted visit_count so the backend default applies", () => {
    const { visit_count: _omitted, ...withoutCount } = valid;
    expect(placeCreateViolations(withoutCount as PlaceCreate)).toEqual([]);
  });

  it("rejects a blank label, out-of-range coordinates and an unknown sensitivity class", () => {
    expect(placeCreateViolations({ ...valid, display_label: "  " })[0]).toMatch(/display_label/);
    expect(placeCreateViolations({ ...valid, latitude: 91 })[0]).toMatch(/latitude/);
    expect(placeCreateViolations({ ...valid, longitude: -181 })[0]).toMatch(/longitude/);
    expect(placeCreateViolations({ ...valid, sensitivity_class: "nope" })[0]).toMatch(/sensitivity_class/);
  });
});
