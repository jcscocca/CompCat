import type { ReactNode } from "react";

import { isNotTested, methodLabel, minimumDataStatusLabel, NO_VALUE, NOT_TESTED_LABEL } from "../lib/analysisTerms";
import { annualIncidentsWithin, formatPerYear } from "../lib/rateFormat";
import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareRelationship, CompareVerdictRow } from "../lib/compareVerdict";

const CHIP: Record<CompareRelationship, { label: string; clear: boolean }> = {
  lowest: { label: "lowest rate", clear: false },
  similar: { label: "no clear difference", clear: false },
  higher: { label: "clearly higher", clear: false },
  limited: { label: "limited data", clear: false },
};

export function CompareRankedList({ rows, noun, radiusM, expansionByOptionId, onHoverRow }: { rows: CompareVerdictRow[]; noun: IncidentNoun; radiusM: number; expansionByOptionId?: Map<string, ReactNode>; onHoverRow?: (optionId: string | null) => void }) {
  return (
    <div className="mc-ranked" data-testid="compare-ranked">
      {rows.map((row) => {
        const chip = CHIP[row.relationship];
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
              {formatPerYear(annualIncidentsWithin(row.rate, radiusM))}/yr{row.multipleOfLowest !== null ? ` · ${row.multipleOfLowest.toFixed(1)}× lowest` : ""}
            </span>
            <span className={`mc-vchip${chip.clear ? " clear" : ""}`}>{chip.label}</span>
            {row.pairwise ? (() => {
              // Below the data floor the engine returns a placeholder row (1.0×, CI 1.0–1.0,
              // p 1.0). Printing those states a precise "no difference" nobody measured.
              const notTested = isNotTested(row.pairwise);
              return (
                <details className="mc-analytical mc-ranked-detail">
                  <summary>How we know</summary>
                  <dl>
                    <div><dt>rate-ratio</dt><dd>{notTested ? NO_VALUE : `${row.pairwise.rate_ratio.toFixed(2)}×`}</dd></div>
                    <div><dt>approx. 95% CI</dt><dd>{notTested ? NO_VALUE : `${row.pairwise.ci_lower.toFixed(2)}–${row.pairwise.ci_upper.toFixed(2)}`}</dd></div>
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
