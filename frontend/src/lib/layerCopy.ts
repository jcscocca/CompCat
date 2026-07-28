import type { LayerKey } from "../types";

/** Noun phrases for the active data layer, so result copy reflects what the user is viewing:
 * the reported-incident (SPD crime reports), arrests (enforcement), and 911 calls-for-service layers. */
export type IncidentNoun = {
  /** e.g. "reported incident" / "911 call" */
  singular: string;
  /** e.g. "reported incidents" / "911 calls" */
  plural: string;
  /** Sentence-case plural for headings, e.g. "Reported incidents" / "911 calls" */
  pluralCap: string;
};

export function incidentNoun(layer: LayerKey): IncidentNoun {
  if (layer === "calls") {
    return { singular: "911 call", plural: "911 calls", pluralCap: "911 calls" };
  }
  if (layer === "arrests") {
    return { singular: "arrest", plural: "arrests", pluralCap: "Arrests" };
  }
  return {
    singular: "reported incident",
    plural: "reported incidents",
    pluralCap: "Reported incidents",
  };
}

/** Pick the singular or plural form for a count. */
export function countNoun(noun: IncidentNoun, count: number): string {
  return count === 1 ? noun.singular : noun.plural;
}

/** The invariant clause. One phrasing everywhere — surfaces that render the caveat as two
 * elements (Notice) compose it from these instead of paraphrasing it, which is how "not
 * safety advice" drifted in alongside "not a personal risk prediction". */
export const CAVEAT_HEADLINE = "Reported incident context, not a personal risk prediction.";

/** The data-limits clause that follows it. */
export const CAVEAT_DATA_LIMITS =
  "Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized.";

/** Product invariant, restated wherever results render (compare panel, expanded rail
 * card): reported-incident context, not a personal risk prediction. */
export const REVISED_CAVEAT = `${CAVEAT_HEADLINE} ${CAVEAT_DATA_LIMITS}`;

/** Explains what the active data layer actually measures — retired from `CompareTab`
 * (deleted in commit `193e0e7`), which rendered this unconditionally whenever the
 * arrests/calls layer was active. Reported has no caveat of its own; arrests and calls
 * do, because both diverge from "a reported incident happened here." */
export function layerDisclosure(layer: LayerKey): string | null {
  if (layer === "calls") {
    return "911 calls are requests for service, not confirmed incidents. The same event can generate several calls, many are proactive officer activity, and a call does not mean a crime occurred. Counts below are call volume, not reported crime.";
  }
  if (layer === "arrests") {
    return "Arrests are enforcement activity, not reported incidents. An arrest is logged where the arrest was made — which may differ from where an offense occurred — and most reported crimes never result in one. Categories are a best-effort NIBRS crosswalk from the arrest offense.";
  }
  return null;
}
