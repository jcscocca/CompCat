import { CAVEAT_DATA_LIMITS, CAVEAT_HEADLINE } from "../lib/layerCopy";

/** The two clauses come from layerCopy so this panel states the invariant in the same words
 * as every result surface — it used to say "not safety advice" instead. */
export function Notice() {
  return (
    <section className="notice" aria-label="Important data note">
      <strong>{CAVEAT_HEADLINE}</strong>
      <span>{CAVEAT_DATA_LIMITS}</span>
    </section>
  );
}
