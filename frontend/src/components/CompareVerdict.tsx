import type { IncidentNoun } from "../lib/layerCopy";
import type { CompareCallout } from "../lib/compareVerdict";

export function CompareVerdict({ callout, noun }: { callout: CompareCallout; noun: IncidentNoun }) {
  const { kind, lowestLabel, loweredCount, otherCount, caveatText } = callout;
  const rate = `${noun.singular} rate`;

  if (kind === "clear") {
    return (
      <div className="mc-verdict tone-ok" data-testid="compare-callout" role="status">
        <p className="mc-verdict-headline">
          <strong>{lowestLabel}</strong> has the lowest {rate} — statistically lower than every other address here.
        </p>
      </div>
    );
  }
  if (kind === "partial") {
    return (
      <div className="mc-verdict tone-ok" data-testid="compare-callout" role="status">
        <p className="mc-verdict-headline">
          <strong>{lowestLabel}</strong> has the lowest {rate} — statistically lower than {loweredCount} of the {otherCount} other addresses. The rest are within normal variation.
        </p>
      </div>
    );
  }
  if (kind === "none") {
    return (
      <div className="mc-verdict tone-muted" data-testid="compare-callout" role="status">
        <p className="mc-verdict-headline">No statistically clear difference in {rate} across these addresses — the gaps fall within normal variation.</p>
      </div>
    );
  }
  return (
    <div className="mc-verdict tone-muted" data-testid="compare-callout" role="status">
      <p className="mc-verdict-headline">Not enough data for a clear comparison across these addresses.</p>
      {caveatText ? <p className="mc-verdict-sub">{caveatText}</p> : null}
    </div>
  );
}
