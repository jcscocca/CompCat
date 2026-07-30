import type { PlaceCreate } from "../types";

/**
 * The `POST /places` request contract, transcribed from `ManualPlaceCreate`
 * (`app/places/schemas.py`, listed in `docs/architecture/api.md`). The UI mocks
 * `createPlace` in tests, so a payload the backend would reject with a 422 still looks
 * like a passing test — assert payloads against this instead of eyeballing them.
 *
 * Keep in sync with the pydantic model; a bound that drifts here is a bound that stops
 * being enforced anywhere in the frontend suite.
 */
export const PLACE_CREATE_CONTRACT = {
  displayLabelMinLength: 1,
  displayLabelMaxLength: 120,
  latitudeMin: -90,
  latitudeMax: 90,
  longitudeMin: -180,
  longitudeMax: 180,
  /** `visit_count: int = Field(default=1, ge=1, le=10000)` — 0 is a 422, not a no-op. */
  visitCountMin: 1,
  visitCountMax: 10000,
  sensitivityClasses: [
    "normal",
    "home_candidate",
    "work_candidate",
    "health_candidate",
    "religious_candidate",
    "suppress_from_public_export",
  ],
} as const;

/** Every way a payload can violate the contract, as human-readable strings. */
export function placeCreateViolations(payload: PlaceCreate): string[] {
  const c = PLACE_CREATE_CONTRACT;
  const problems: string[] = [];
  const label = payload.display_label;
  if (typeof label !== "string" || label.trim().length < c.displayLabelMinLength) {
    problems.push(`display_label must be a non-blank string (got ${JSON.stringify(label)})`);
  } else if (label.length > c.displayLabelMaxLength) {
    problems.push(`display_label must be <= ${c.displayLabelMaxLength} chars (got ${label.length})`);
  }
  if (!Number.isFinite(payload.latitude) || payload.latitude < c.latitudeMin || payload.latitude > c.latitudeMax) {
    problems.push(`latitude must be within [${c.latitudeMin}, ${c.latitudeMax}] (got ${payload.latitude})`);
  }
  if (!Number.isFinite(payload.longitude) || payload.longitude < c.longitudeMin || payload.longitude > c.longitudeMax) {
    problems.push(`longitude must be within [${c.longitudeMin}, ${c.longitudeMax}] (got ${payload.longitude})`);
  }
  if (payload.visit_count !== undefined) {
    if (!Number.isInteger(payload.visit_count) || payload.visit_count < c.visitCountMin || payload.visit_count > c.visitCountMax) {
      problems.push(`visit_count must be an integer within [${c.visitCountMin}, ${c.visitCountMax}] (got ${payload.visit_count})`);
    }
  }
  if (payload.sensitivity_class !== undefined && !c.sensitivityClasses.includes(payload.sensitivity_class as never)) {
    problems.push(`sensitivity_class must be one of ${c.sensitivityClasses.join(", ")} (got ${payload.sensitivity_class})`);
  }
  return problems;
}

/** Throws with every violation listed, so a failing assertion names the offending field. */
export function assertValidPlaceCreate(payload: PlaceCreate): void {
  const problems = placeCreateViolations(payload);
  if (problems.length > 0) {
    throw new Error(`POST /places payload would 422:\n  - ${problems.join("\n  - ")}`);
  }
}
