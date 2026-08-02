import type { ReactNode } from "react";

import { isNotTested, methodLabel, minimumDataStatusLabel, NO_VALUE, NOT_TESTED_LABEL } from "../lib/analysisTerms";
import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareRelationship, CompareVerdictRow } from "../lib/compareVerdict";

function chipFor(
  relationship: CompareRelationship,
  exactlyTwo: boolean,
  sameObservedRate: boolean,
): { label: string; clear: boolean } {
  if (relationship === "lowest") {
    if (sameObservedRate) return { label: "same observed rate", clear: false };
    return {
      label: exactlyTwo ? "lower observed rate" : "lowest observed rate",
      clear: false,
    };
  }
  if (relationship === "similar") {
    return {
      label: exactlyTwo
        ? "no statistically clear difference"
        : "no clear difference from lowest",
      clear: false,
    };
  }
  if (relationship === "higher") {
    return {
      label: exactlyTwo ? "statistically higher rate" : "statistically higher than lowest",
      clear: false,
    };
  }
  return { label: "limited data", clear: false };
}

function pairwiseInRowDirection(row: CompareVerdictRow) {
  const pair = row.pairwise;
  if (!pair) return null;
  if (pair.option_a_id === row.optionId) {
    return {
      ratio: pair.rate_ratio,
      ciLow: pair.ci_lower,
      ciHigh: pair.ci_upper,
    };
  }
  if (
    pair.option_b_id !== row.optionId
    || pair.rate_ratio <= 0
    || pair.ci_lower <= 0
    || pair.ci_upper <= 0
  ) {
    return null;
  }
  return {
    ratio: 1 / pair.rate_ratio,
    ciLow: 1 / pair.ci_upper,
    ciHigh: 1 / pair.ci_lower,
  };
}

export function CompareRankedList({ rows, noun, radiusM, expansionByOptionId, onHoverRow }: { rows: CompareVerdictRow[]; noun: IncidentNoun; radiusM: number; expansionByOptionId?: Map<string, ReactNode>; onHoverRow?: (optionId: string | null) => void }) {
  const exactlyTwo = rows.length === 2;
  const sameObservedRate = exactlyTwo && rows[0]?.rate === rows[1]?.rate;
  const multipleReference = exactlyTwo
    ? "the other observed rate"
    : "the lowest observed rate";

  return (
    <div className="mc-ranked" data-testid="compare-ranked">
      {rows.map((row) => {
        const chip = chipFor(row.relationship, exactlyTwo, sameObservedRate);
        const expansion = expansionByOptionId?.get(row.optionId) ?? null;
        return (
          <div
            className={`mc-ranked-row${row.relationship === "lowest" ? " is-lowest" : ""}`}
            key={row.optionId}
            onMouseEnter={onHoverRow ? () => onHoverRow(row.optionId) : undefined}
            onMouseLeave={onHoverRow ? () => onHoverRow(null) : undefined}
          >
            <span className="mc-rank">{row.rank}</span>
            <div className="mc-ranked-name">
              <strong>{row.label}</strong>
              <small>{row.incidentCount} {noun.plural}</small>
            </div>
            <div className="mc-ranked-bar"><span style={{ width: `${Math.round(row.barFraction * 100)}%` }} /></div>
            <span className="mc-ranked-rate">
              {formatPerYear(annualIncidentsWithin(row.rate, radiusM))}/yr{row.multipleOfLowest !== null ? ` · ${row.multipleOfLowest.toFixed(1)}× ${multipleReference}` : ""}
            </span>
            <span className={`mc-vchip${chip.clear ? " clear" : ""}`}>{chip.label}</span>
            {row.pairwise ? (() => {
              // Below the data floor the engine returns a placeholder row (1.0×, CI 1.0–1.0,
              // p 1.0). Printing those states a precise "no difference" nobody measured.
              const notTested = isNotTested(row.pairwise);
              const displayedPairwise = notTested ? null : pairwiseInRowDirection(row);
              return (
                <details className="mc-analytical mc-ranked-detail">
                  <summary>How we know</summary>
                  <dl>
                    <div><dt>rate vs {multipleReference}</dt><dd>{displayedPairwise ? `${displayedPairwise.ratio.toFixed(2)}×` : NO_VALUE}</dd></div>
                    <div><dt>approx. 95% ratio CI</dt><dd>{displayedPairwise ? `${displayedPairwise.ciLow.toFixed(2)}–${displayedPairwise.ciHigh.toFixed(2)}` : NO_VALUE}</dd></div>
                    <div><dt>adjusted p</dt><dd>{notTested ? NO_VALUE : row.pairwise.adjusted_p_value.toFixed(3)}</dd></div>
                    <div><dt>method</dt><dd>{notTested ? NOT_TESTED_LABEL : methodLabel(row.pairwise.method)}</dd></div>
                    <div><dt>data floor</dt><dd>{minimumDataStatusLabel(row.pairwise.minimum_data_status)}</dd></div>
                  </dl>
                </details>
              );
            })() : null}
            {expansion ? (
              <details className="mc-analytical mc-ranked-detail mc-ranked-context">
                <summary>Full context</summary>
                {expansion}
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
