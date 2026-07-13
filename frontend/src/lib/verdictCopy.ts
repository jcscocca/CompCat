import type { BaselineEntry, NeighborhoodPlace } from "../types";
import { incidentNoun, type IncidentNoun } from "./layerCopy";

const KIND_ORDER: BaselineEntry["kind"][] = ["mcpp", "beat", "sector", "city"];
const RELATION_ORDER = ["above", "below", "similar"] as const;

function baselineName(entry: BaselineEntry): string {
  if (entry.kind === "city") return "the citywide rate";
  if (entry.kind === "beat") return `its beat (${entry.label.replace(/^Beat /, "")})`;
  if (entry.kind === "sector") return `its sector (${entry.label.replace(/^Sector /, "")})`;
  return entry.label;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// One aggregate sentence over the baselines[] relations — no baseline is singled out,
// matching the plot's equal-rows treatment. Relations come verbatim from the payload
// (server-side decision machinery); this function only phrases them.
export function aggregateHeadline(
  place: Pick<NeighborhoodPlace, "place_label" | "baselines" | "minimum_data_status" | "radius_m">,
  noun: IncidentNoun = incidentNoun("reported"),
): string {
  const label = place.place_label || "This place";
  const usable = (place.baselines ?? [])
    .filter((entry) => entry.relation !== "insufficient")
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  if (usable.length === 0) {
    if (place.minimum_data_status === "baseline_too_small") {
      return `${label}'s ${place.radius_m} m radius covers nearly all of its surrounding area — there is no area left to compare against. Try a smaller radius.`;
    }
    if ((place.baselines ?? []).length > 0) {
      return `Not enough data to compare ${label} to its area baselines.`;
    }
    return `No area baseline available for ${label}.`;
  }
  const groups: Record<(typeof RELATION_ORDER)[number], string[]> = { above: [], below: [], similar: [] };
  for (const entry of usable) {
    groups[entry.relation as (typeof RELATION_ORDER)[number]].push(baselineName(entry));
  }
  const parts = RELATION_ORDER.filter((relation) => groups[relation].length > 0).map((relation) =>
    relation === "similar" ? `similar to ${joinList(groups[relation])}` : `${relation} ${joinList(groups[relation])}`,
  );
  return `${label}'s ${noun.singular} rate is ${parts.join("; ")}.`;
}
