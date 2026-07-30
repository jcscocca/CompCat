import { describe, expect, it } from "vitest";

import { coordinateLabel, labelOrDefault, PLACE_LABEL_PLACEHOLDER } from "./placeDefaults";

describe("placeDefaults", () => {
  it("keeps a typed label, trimmed", () => {
    expect(labelOrDefault("  Home  ", { latitude: 47.6012, longitude: -122.3312 })).toBe("Home");
  });

  // Regression: an unnamed place used to persist as the fixed string "Test location", so a
  // saved place claimed to be something it was not.
  it("falls back to the coordinates, never a fixed name", () => {
    expect(labelOrDefault("", { latitude: 47.6012, longitude: -122.3312 })).toBe("Pin at 47.601, -122.331");
    expect(labelOrDefault("   ", { latitude: 47.6012, longitude: -122.3312 })).toBe("Pin at 47.601, -122.331");
  });

  it("renders coordinates to three decimals", () => {
    expect(coordinateLabel(47.6, -122.3)).toBe("Pin at 47.600, -122.300");
  });

  it("prompts for an optional name", () => {
    expect(PLACE_LABEL_PLACEHOLDER).toBe("Name this place (optional)");
  });
});
