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
