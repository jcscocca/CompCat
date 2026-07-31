import type { AssistantMessage, AssistantResultContext } from "../types";
import type { AnalysisCardData } from "./assistantBridge";

/** One entry in the Tabby rail. Only user/tabby text round-trips to the LLM;
 * receipts, notices, and analysis cards are local-only records (deterministic
 * confirmations, errors, frozen analysis snapshots) per the Tabby-central spec. */
export type ThreadItem =
  | { kind: "user_text"; text: string }
  | { kind: "tabby_text"; text: string }
  | { kind: "receipt"; text: string }
  | { kind: "notice"; text: string }
  | { kind: "analysis_card"; card: AnalysisCardData };

export function toApiMessages(items: ThreadItem[]): AssistantMessage[] {
  const messages: AssistantMessage[] = [];
  for (const item of items) {
    if (item.kind === "user_text") messages.push({ role: "user", content: item.text });
    else if (item.kind === "tabby_text") messages.push({ role: "assistant", content: item.text });
  }
  return messages;
}

/** The newest saved-place card's reproducible scope; raw result rows remain client-local. */
export function latestResultContext(items: ThreadItem[]): AssistantResultContext | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.kind !== "analysis_card") continue;
    const { card } = item;
    const placeIds = Array.from(new Set(card.placeIds));
    const start = card.settings.analysis_start_date;
    const end = card.settings.analysis_end_date;
    const radius = card.settings.radius_m;
    const layer = card.settings.layer;
    if (
      placeIds.length === 0 ||
      (card.kind === "compare" && placeIds.length < 2) ||
      typeof start !== "string" ||
      typeof end !== "string" ||
      typeof radius !== "number" ||
      (layer !== "reported" && layer !== "arrests" && layer !== "calls")
    ) {
      return null;
    }
    return {
      kind: card.kind,
      place_ids: placeIds,
      analysis_start_date: start,
      analysis_end_date: end,
      radius_m: radius,
      offense_category: card.settings.offense_category ?? null,
      offense_subcategory: card.settings.offense_subcategory ?? null,
      nibrs_group: card.settings.nibrs_group ?? null,
      layer,
    };
  }
  return null;
}
