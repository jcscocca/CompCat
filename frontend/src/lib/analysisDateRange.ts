import { ANALYSIS_MIN_DATE } from "./analysisDefaults";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DATE_RANGE_ERROR = "Start date must be on or before end date.";
export const MAX_ANALYSIS_SPAN_DAYS = 3000;
export const MAX_ANALYSIS_FUTURE_DAYS = 366;
export const DATE_RANGE_SPAN_ERROR = `Date range must be ${MAX_ANALYSIS_SPAN_DAYS} days or fewer.`;

function formatUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Keep the browser contract aligned with app/api/dashboard_schemas.py. */
export function maxAnalysisDate(now = new Date()): string {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return formatUtcDate(todayUtc + MAX_ANALYSIS_FUTURE_DAYS * DAY_MS);
}

function parseIsoCalendarDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = Date.UTC(year, month - 1, day);
  const date = new Date(parsed);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? parsed
    : null;
}

/** Date inputs and API schemas use zero-padded ISO dates, so lexical order is chronological. */
export function isOrderedAnalysisDateRange(startDate: string, endDate: string): boolean {
  return parseIsoCalendarDate(startDate) !== null
    && parseIsoCalendarDate(endDate) !== null
    && startDate <= endDate;
}

export function analysisDateRangeError(
  startDate: string,
  endDate: string,
  now = new Date(),
): string | null {
  const start = parseIsoCalendarDate(startDate);
  const end = parseIsoCalendarDate(endDate);
  if (start === null || end === null || start > end) return DATE_RANGE_ERROR;
  const latest = maxAnalysisDate(now);
  if (startDate < ANALYSIS_MIN_DATE || endDate > latest) {
    return `Dates must fall between ${ANALYSIS_MIN_DATE} and ${latest}.`;
  }
  if ((end - start) / DAY_MS > MAX_ANALYSIS_SPAN_DAYS) return DATE_RANGE_SPAN_ERROR;
  return null;
}

export function isValidAnalysisDateRange(startDate: string, endDate: string): boolean {
  return analysisDateRangeError(startDate, endDate) === null;
}
