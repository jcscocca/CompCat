/** Prompt shown on every optional place-label field. */
export const PLACE_LABEL_PLACEHOLDER = "Name this place (optional)";

/** How an unnamed place identifies itself in lists, chips and cards: where it is. */
export function coordinateLabel(latitude: number, longitude: number): string {
  return `Pin at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/**
 * The label to persist for a place. A typed name wins; otherwise the caller's own default
 * (the reverse-geocoded/search label, when the pin came from a search) and finally the
 * coordinates. Never a fixed string — "Test location" used to be persisted verbatim, so a
 * saved place could claim to be something it was not.
 */
export function labelOrDefault(
  label: string,
  coords: { latitude: number; longitude: number },
): string {
  return label.trim() || coordinateLabel(coords.latitude, coords.longitude);
}
