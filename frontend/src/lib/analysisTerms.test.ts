import { describe, expect, it } from "vitest";

import {
  isNotTested,
  methodLabel,
  minimumDataStatusLabel,
  NOT_TESTED_LABEL,
  NOT_TESTED_METHOD,
  NO_VALUE,
} from "./analysisTerms";

describe("minimumDataStatusLabel", () => {
  it("names every status the analysis engines emit", () => {
    // The full set from app/analysis/beat_baselines.py and app/analysis/comparison.py.
    expect(minimumDataStatusLabel("met")).toBe("met");
    expect(minimumDataStatusLabel("place_count_too_low")).toBe("fewer than 3 incidents at this place");
    expect(minimumDataStatusLabel("option_count_too_low")).toBe("fewer than 3 incidents at this location");
    expect(minimumDataStatusLabel("combined_count_too_low")).toBe("fewer than 10 incidents combined");
    expect(minimumDataStatusLabel("date_range_too_short")).toBe("window shorter than 30 days");
    expect(minimumDataStatusLabel("non_positive_exposure")).toBe("no area-time to compare against");
    expect(minimumDataStatusLabel("baseline_too_small")).toBe("baseline area too small to compare");
  });

  it("never leaves a raw identifier on screen", () => {
    expect(minimumDataStatusLabel("some_future_status")).toBe("some future status");
    expect(minimumDataStatusLabel(undefined)).toBe(NO_VALUE);
    expect(minimumDataStatusLabel("")).toBe(NO_VALUE);
  });
});

describe("methodLabel", () => {
  it("names the fitted models", () => {
    expect(methodLabel("quasi_poisson_log_rate_ratio")).toBe("quasi-Poisson");
    expect(methodLabel("wald_log_rate_ratio")).toBe("Wald");
    expect(methodLabel(NOT_TESTED_METHOD)).toBe(NOT_TESTED_LABEL);
  });
});

describe("isNotTested", () => {
  const tested = {
    method: "wald_log_rate_ratio",
    minimum_data_status: "met",
    rate_ratio: 1.8,
    ci_lower: 1.2,
    ci_upper: 2.7,
    adjusted_p_value: 0.01,
  };

  it("passes a genuinely fitted row through", () => {
    expect(isNotTested(tested)).toBe(false);
  });

  it("catches the engine's explicit not-tested marker", () => {
    expect(isNotTested({ ...tested, method: NOT_TESTED_METHOD })).toBe(true);
    expect(isNotTested({ ...tested, minimum_data_status: "combined_count_too_low" })).toBe(true);
    expect(isNotTested({ ...tested, relation: "insufficient" })).toBe(true);
  });

  // _not_tested_pairwise (app/analysis/comparison.py) fabricates exactly this row; rendering
  // it says "no difference, precisely measured" about a pair that was never tested.
  it("catches the synthetic 1.0 placeholder even without a marker", () => {
    expect(isNotTested({ rate_ratio: 1, ci_lower: 1, ci_upper: 1, adjusted_p_value: 1 })).toBe(true);
  });

  it("does not mistake a real ratio of exactly 1 with a real interval for a placeholder", () => {
    expect(isNotTested({ ...tested, rate_ratio: 1, ci_lower: 0.7, ci_upper: 1.4, adjusted_p_value: 0.9 })).toBe(false);
  });
});
