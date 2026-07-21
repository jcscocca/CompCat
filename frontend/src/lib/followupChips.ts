import type { AssistantCommandName } from "../api/client";
import type { AnalysisCardData, SettingsUsed } from "../types";

export type FollowupChip = {
  label: string;
  command: AssistantCommandName;
  /** Merged over the re-run command's arguments (field shapes per command). */
  argsPatch: Record<string, unknown>;
  /** The settings delta the chip represents (used only for labeling/receipts). */
  settingsPatch: Partial<SettingsUsed>;
  /** Full-args override. When present, the chip runs its command with these args verbatim
   * (null/undefined stripped) instead of deriving them from a card via buildRerunArgs —
   * used by deterministic place-added offers, which have no card to re-run against. */
  args?: Record<string, unknown>;
};

/** Deterministic follow-ups for the newest analysis card. No LLM involved —
 * these must keep working in degraded mode. */
export function followupChipsFor(
  kind: "analyze" | "compare",
  settings: SettingsUsed,
  availableRadii: number[],
): FollowupChip[] {
  const command: AssistantCommandName = kind === "compare" ? "compare_places" : "analyze_places";
  const radii = availableRadii.length > 0 ? availableRadii : [250, 500, 1000];
  const sorted = [...radii].sort((a, b) => a - b);
  const current = settings.radius_m ?? sorted[0];
  const index = sorted.indexOf(current);
  const chips: FollowupChip[] = [];

  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;
  const prev = index > 0 ? sorted[index - 1] : null;
  const radius = next ?? prev;
  if (radius !== null) {
    const radiusArgs = command === "analyze_places" ? { radii_m: [radius] } : { radius_m: radius };
    chips.push({
      label: `${next !== null ? "Widen" : "Tighten"} to ${radius} m`,
      command,
      argsPatch: radiusArgs,
      settingsPatch: { radius_m: radius },
    });
  }

  if (settings.layer !== "calls") {
    if (settings.offense_category) {
      chips.push({
        label: "All categories",
        command,
        // AnalyzePlacesArgs / ComparePlacesByNameArgs (app/assistant/tools.py) don't accept
        // the "ALL" sentinel — that only exists on UpdateFiltersArgs. Clearing the category
        // here means omitting the field, so the patch carries an explicit null for the
        // arg-builder (wired in a later slice) to strip before the command is sent.
        argsPatch: { offense_category: null },
        settingsPatch: { offense_category: null },
      });
    } else {
      chips.push({
        label: "Property only",
        command,
        argsPatch: { offense_category: "PROPERTY" },
        settingsPatch: { offense_category: "PROPERTY" },
      });
    }
  }

  if (settings.layer === "reported" || settings.layer === undefined) {
    chips.push({
      label: "Check 911 calls",
      command,
      argsPatch: { layer: "calls" },
      settingsPatch: { layer: "calls" },
    });
  } else {
    chips.push({
      label: "Back to police reports",
      command,
      argsPatch: { layer: "reported" },
      settingsPatch: { layer: "reported" },
    });
  }

  return chips;
}

/** Assemble the re-run command arguments for a follow-up chip: base scope from the card's
 * OWN frozen settings + placeIds (never live dashboard state), the radius in the field shape
 * the target command expects, offense_category only when the card had one, then the chip's
 * argsPatch merged on top. Null/undefined entries are stripped last so "omitted means all
 * reported" fields don't hard-fail arg validation (e.g. the "All categories" chip's null).
 *
 * Known limitation: re-runs reset to offense-CATEGORY granularity. SettingsUsed cannot carry
 * offense_subcategory / nibrs_group — the backend deliberately omits those from `_settings_used`
 * (no UI control echoes them). If they ever become settable, cards must freeze the raw filter
 * first, or a narrowed re-run would silently widen back to the category. */
export function buildRerunArgs(card: AnalysisCardData, chip: FollowupChip): Record<string, unknown> {
  const s = card.settings;
  const radius = s.radius_m ?? null;
  const base: Record<string, unknown> = {
    place_ids: card.placeIds,
    analysis_start_date: s.analysis_start_date ?? null,
    analysis_end_date: s.analysis_end_date ?? null,
    layer: s.layer,
    ...(chip.command === "analyze_places"
      ? { radii_m: radius !== null ? [radius] : null }
      : { radius_m: radius }),
    ...(s.offense_category ? { offense_category: s.offense_category } : {}),
  };
  const args = { ...base, ...chip.argsPatch };
  for (const key of Object.keys(args)) if (args[key] == null) delete args[key];
  return args;
}
