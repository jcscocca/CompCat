// Mirrors the backend SensitivityClass enum (app/places/schemas.py). Any non-"normal" class
// is excluded from the public Tableau export; the UI surfaces that as "Hidden from exports".
export const SENSITIVITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "home_candidate", label: "Home" },
  { value: "work_candidate", label: "Work" },
  { value: "health_candidate", label: "Health-related" },
  { value: "religious_candidate", label: "Religious" },
  { value: "suppress_from_public_export", label: "Hide from exports" },
] as const;

export function isSensitive(sensitivityClass: string | null | undefined): boolean {
  return !!sensitivityClass && sensitivityClass !== "normal";
}
