type Props = {
  comparison: Record<string, unknown> | null;
};

export function ComparisonPanel({ comparison }: Props) {
  if (!comparison) {
    return (
      <section className="panel comparison-panel" aria-labelledby="comparison-title">
        <h2 id="comparison-title">Comparison</h2>
        <p className="muted">
          Select at least two places to compare reported-incident rates.
        </p>
      </section>
    );
  }

  const overview = comparison.overview as
    | {
        summary_text?: string;
        caveat_text?: string;
        decision_class?: string;
      }
    | undefined;

  return (
    <section className="panel comparison-panel" aria-labelledby="comparison-title">
      <h2 id="comparison-title">Comparison</h2>
      {overview?.decision_class ? (
        <p className="panel-label">{overview.decision_class}</p>
      ) : null}
      <p>{overview?.summary_text ?? "Comparison complete."}</p>
      {overview?.caveat_text ? <p className="muted">{overview.caveat_text}</p> : null}
    </section>
  );
}
