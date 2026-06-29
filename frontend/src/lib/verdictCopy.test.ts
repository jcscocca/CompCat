import { describe, expect, it } from "vitest";

import { decisionHeadline } from "./verdictCopy";

const at = (decision: string) =>
  decisionHeadline({ decision, place_label: "Home" } as never);

describe("decisionHeadline", () => {
  it("maps above_clear to a 'more' headline with a clear chip", () => {
    const v = at("above_clear");
    expect(v.headline).toBe("Home has more reported incidents than its surrounding beat.");
    expect(v.chip).toEqual({ label: "✓ statistically clear", tone: "clear" });
  });

  it("maps below_clear to a 'fewer' headline with a clear chip", () => {
    const v = at("below_clear");
    expect(v.headline).toBe("Home has fewer reported incidents than its surrounding beat.");
    expect(v.chip).toEqual({ label: "✓ statistically clear", tone: "clear" });
  });

  it("maps not_clear to an 'about the same' headline with a muted chip", () => {
    const v = at("not_clear");
    expect(v.headline).toBe("Home is about the same as its surrounding beat.");
    expect(v.chip).toEqual({ label: "~ not statistically clear", tone: "muted" });
  });

  it("maps insufficient_data and model_warning to a 'not enough data' headline", () => {
    expect(at("insufficient_data").headline).toBe("Not enough data to compare Home to its beat.");
    expect(at("model_warning").headline).toBe("Not enough data to compare Home to its beat.");
    expect(at("insufficient_data").chip).toEqual({ label: "too little data", tone: "muted" });
    expect(at("model_warning").chip).toEqual({ label: "too little data", tone: "muted" });
  });

  it("maps baseline_unavailable to a 'no baseline' headline", () => {
    const v = at("baseline_unavailable");
    expect(v.headline).toBe("No neighborhood baseline available for Home.");
    expect(v.chip).toEqual({ label: "no baseline", tone: "muted" });
  });

  it("falls back safely for an unknown decision", () => {
    const v = at("something_new");
    expect(v.headline).toBe("Home compared to its surrounding beat.");
    expect(v.chip.tone).toBe("muted");
  });

  it("falls back to 'This place' when place_label is empty", () => {
    expect(
      decisionHeadline({ decision: "not_clear", place_label: "" } as never).headline,
    ).toBe("This place is about the same as its surrounding beat.");
  });
});
