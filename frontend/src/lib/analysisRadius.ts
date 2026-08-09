export const MIN_ANALYSIS_RADIUS_M = 100;
export const MAX_ANALYSIS_RADIUS_M = 1000;

export type RadiusParseResult =
  | { meters: number; error: null }
  | { meters: null; error: string };

/** Parses the custom-radius field, whose only unit is whole meters. */
export function parseAnalysisRadius(input: string): RadiusParseResult {
  const normalized = input.trim();
  if (!normalized) return { meters: null, error: "Enter a radius in meters." };
  if (!/^\d+$/.test(normalized)) {
    return { meters: null, error: "Enter a whole number of meters." };
  }

  const meters = Number(normalized);
  if (meters < MIN_ANALYSIS_RADIUS_M || meters > MAX_ANALYSIS_RADIUS_M) {
    return { meters: null, error: "Choose a radius from 100 to 1,000 meters." };
  }
  return { meters, error: null };
}
