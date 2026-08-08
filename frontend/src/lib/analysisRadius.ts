export const MIN_ANALYSIS_RADIUS_M = 100;
export const MAX_ANALYSIS_RADIUS_M = 1000;

export type RadiusParseResult =
  | { meters: number; error: null }
  | { meters: null; error: string };

const UNIT_MULTIPLIERS: Record<string, number> = {
  "": 1,
  m: 1,
  meter: 1,
  meters: 1,
  metre: 1,
  metres: 1,
  km: 1000,
  kilometer: 1000,
  kilometers: 1000,
  kilometre: 1000,
  kilometres: 1000,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  mi: 1609.344,
  mile: 1609.344,
  miles: 1609.344,
};

function numericValue(raw: string): number | null {
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Parses a human-entered distance and normalizes it to the integer-meter report contract. */
export function parseAnalysisRadius(input: string): RadiusParseResult {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/^¼/, "0.25")
    .replace(/^½/, "0.5")
    .replace(/^¾/, "0.75");
  if (!normalized) return { meters: null, error: "Enter a radius." };

  const match = normalized.match(
    /^((?:\d+(?:\.\d+)?|\.\d+)|(?:\d+\s*\/\s*\d+))\s*([a-z]*)$/,
  );
  if (!match || !(match[2] in UNIT_MULTIPLIERS)) {
    return {
      meters: null,
      error: "Use a distance such as 400 m, 0.4 km, 1,300 ft, or ¼ mile.",
    };
  }

  const amount = numericValue(match[1]);
  if (amount === null || amount <= 0) {
    return { meters: null, error: "Enter a positive distance." };
  }
  const meters = Math.round(amount * UNIT_MULTIPLIERS[match[2]]);
  if (meters < MIN_ANALYSIS_RADIUS_M || meters > MAX_ANALYSIS_RADIUS_M) {
    return { meters: null, error: "Choose a radius from 100 m to 1 km." };
  }
  return { meters, error: null };
}
