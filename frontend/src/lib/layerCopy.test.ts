import { describe, expect, it } from "vitest";
import { incidentNoun } from "./layerCopy";

describe("incidentNoun arrests", () => {
  it("uses arrest nouns for the arrests layer", () => {
    expect(incidentNoun("arrests")).toEqual({ singular: "arrest", plural: "arrests", pluralCap: "Arrests" });
  });
});
