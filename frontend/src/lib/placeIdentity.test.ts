import { describe, expect, it } from "vitest";

import { placeIdentity } from "./placeIdentity";

describe("placeIdentity", () => {
  it("assigns letters and color slots in fixed order", () => {
    expect(placeIdentity(0)).toEqual({ letter: "A", slot: "a" });
    expect(placeIdentity(3)).toEqual({ letter: "D", slot: "d" });
  });

  it("falls back to the neutral slot beyond four places, letters continue", () => {
    expect(placeIdentity(4)).toEqual({ letter: "E", slot: "x" });
    expect(placeIdentity(25)).toEqual({ letter: "Z", slot: "x" });
  });

  it("numbers places beyond Z", () => {
    expect(placeIdentity(26)).toEqual({ letter: "#27", slot: "x" });
  });
});
