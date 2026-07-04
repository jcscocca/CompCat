import type { SiteComparison, SitePairwiseResult } from "../types";

export type CompareRelationship = "lowest" | "similar" | "higher" | "limited";

export type CompareVerdictRow = {
  rank: number;
  optionId: string;
  label: string;
  incidentCount: number;
  rate: number;
  barFraction: number;
  multipleOfLowest: number | null;
  relationship: CompareRelationship;
  pairwise: SitePairwiseResult | null;
};

export type CompareCalloutKind = "clear" | "partial" | "none" | "inconclusive";

export type CompareCallout = {
  kind: CompareCalloutKind;
  lowestLabel: string;
  loweredCount: number;
  otherCount: number;
  caveatText: string;
};

export type CompareVerdictModel = {
  rows: CompareVerdictRow[];
  callout: CompareCallout;
};

function relationshipFor(pair: SitePairwiseResult | null): CompareRelationship {
  if (!pair) return "limited";
  if (pair.decision_class === "statistically_lower") return "higher";
  if (pair.decision_class === "not_statistically_clear") return "similar";
  return "limited"; // insufficient_data | model_warning
}

export function toCompareVerdict(comparison: SiteComparison): CompareVerdictModel {
  const options = comparison.analytical.options;
  const pairwise = comparison.analytical.pairwise_results;
  const sorted = [...options].sort((a, b) => a.incident_rate - b.incident_rate);
  const candidate = sorted[0];
  const maxRate = sorted.length ? sorted[sorted.length - 1].incident_rate : 0;
  const lowestRate = candidate ? candidate.incident_rate : 0;

  // Each pairwise is candidate-vs-one-other; key by the "other" option id.
  const pairByOther = new Map<string, SitePairwiseResult>();
  for (const p of pairwise) {
    const otherId = candidate && p.option_a_id === candidate.id ? p.option_b_id
      : candidate && p.option_b_id === candidate.id ? p.option_a_id
      : null;
    if (otherId) pairByOther.set(otherId, p);
  }

  const rows: CompareVerdictRow[] = sorted.map((o, i) => {
    const isLowest = candidate ? o.id === candidate.id : false;
    const pair = isLowest ? null : pairByOther.get(o.id) ?? null;
    return {
      rank: i + 1,
      optionId: o.id,
      label: o.label,
      incidentCount: o.incident_count,
      rate: o.incident_rate,
      barFraction: maxRate > 0 ? o.incident_rate / maxRate : 0,
      multipleOfLowest: isLowest || lowestRate <= 0 ? null : o.incident_rate / lowestRate,
      relationship: isLowest ? "lowest" : relationshipFor(pair),
      pairwise: pair,
    };
  });

  const otherCount = Math.max(0, sorted.length - 1);
  const loweredCount = pairwise.filter((p) => p.decision_class === "statistically_lower").length;
  const overall = comparison.overview.decision_class;
  let kind: CompareCalloutKind;
  if (overall === "statistically_lower") kind = "clear";
  else if (overall === "insufficient_data" || overall === "model_warning") kind = "inconclusive";
  else kind = loweredCount >= 1 ? "partial" : "none";

  const caveatText = comparison.analytical.full_caveat_text || comparison.overview.caveat_text || "";

  return {
    rows,
    callout: { kind, lowestLabel: candidate ? candidate.label : "", loweredCount, otherCount, caveatText },
  };
}
