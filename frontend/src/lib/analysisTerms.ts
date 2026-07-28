/**
 * Human wording for the raw enum strings the analysis payloads carry, plus the check for
 * rows that were never actually tested.
 *
 * The API returns machine identifiers (`combined_count_too_low`, `wald_log_rate_ratio`);
 * they were rendered verbatim in the "How we know" panels, which is where a reader who
 * wants to understand the result goes.
 */

/** `not_tested_minimum_data` — the comparison engine's placeholder method. */
export const NOT_TESTED_METHOD = "not_tested_minimum_data";
export const NOT_TESTED_LABEL = "not tested — below the data floor";
/** Rendered in place of every analytical number on an untested row. */
export const NO_VALUE = "—";

const MINIMUM_DATA_STATUS_COPY: Record<string, string> = {
  met: "met",
  // Floors live in app/analysis/rate_tests.py (MIN_PLACE_COUNT 3, MIN_COMBINED_COUNT 10,
  // MIN_ANALYSIS_DAYS 30); keep these numbers in step with them.
  place_count_too_low: "fewer than 3 incidents at this place",
  option_count_too_low: "fewer than 3 incidents at this location",
  combined_count_too_low: "fewer than 10 incidents combined",
  date_range_too_short: "window shorter than 30 days",
  non_positive_exposure: "no area-time to compare against",
  baseline_too_small: "baseline area too small to compare",
};

const METHOD_COPY: Record<string, string> = {
  quasi_poisson_log_rate_ratio: "quasi-Poisson",
  wald_log_rate_ratio: "Wald",
  [NOT_TESTED_METHOD]: NOT_TESTED_LABEL,
};

/** Fall back to the raw identifier made readable, so a new backend value is never opaque. */
function humanize(value: string): string {
  return value.replace(/_/g, " ").trim();
}

export function minimumDataStatusLabel(status: string | null | undefined): string {
  if (!status) return NO_VALUE;
  return MINIMUM_DATA_STATUS_COPY[status] ?? humanize(status);
}

export function methodLabel(method: string): string {
  return METHOD_COPY[method] ?? humanize(method);
}

type MaybeTested = {
  method?: string | null;
  minimum_data_status?: string | null;
  relation?: string | null;
  rate_ratio?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
  adjusted_p_value?: number | null;
};

/**
 * True when a row's analytical numbers are placeholders rather than measurements.
 *
 * The comparison engine returns a synthetic row (rate_ratio 1.0, CI 1.0–1.0, p 1.0) when a
 * pair falls below the data floor — see `_not_tested_pairwise` in app/analysis/comparison.py.
 * Rendering those as "1.00×, CI 1.00–1.00, adj p 1.000" states a precise finding of "no
 * difference" that was never computed. The explicit method/relation markers are the primary
 * signal; the exact-1.0 pattern is the belt-and-braces one.
 */
export function isNotTested(row: MaybeTested): boolean {
  if (row.method === NOT_TESTED_METHOD) return true;
  if (row.relation === "insufficient") return true;
  const status = row.minimum_data_status;
  if (status != null && status !== "met") return true;
  return (
    row.rate_ratio === 1 && row.ci_lower === 1 && row.ci_upper === 1 && row.adjusted_p_value === 1
  );
}
