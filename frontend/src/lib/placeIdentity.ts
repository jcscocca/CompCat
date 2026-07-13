// Stable per-place identity for the Analyze pane (and, in slice 3, map pins): a letter
// by position plus one of four validated color slots. The letter is the primary
// encoding — color never carries identity alone, so the neutral fallback is safe.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLOTS = ["a", "b", "c", "d"] as const;

export type IdentitySlot = (typeof SLOTS)[number] | "x";
export type PlaceIdentity = { letter: string; slot: IdentitySlot };

export function placeIdentity(index: number): PlaceIdentity {
  const letter = index < LETTERS.length ? LETTERS[index] : `#${index + 1}`;
  const slot: IdentitySlot = index < SLOTS.length ? SLOTS[index] : "x";
  return { letter, slot };
}
