# Claude Opus review — layer-aware analysis reports and exports

**Date:** 2026-08-02

**Reviewed proposal:**
[`docs/superpowers/specs/2026-08-02-layer-aware-analysis-reports-and-exports-design.md`](../superpowers/specs/2026-08-02-layer-aware-analysis-reports-and-exports-design.md)

**Repository basis:** `origin/main` at `ac68758`

**Reviewer:** Claude Code CLI 2.1.113, Claude Opus 4.7, high effort, read-only

## Review method

Claude was asked to act as a skeptical senior product architect and applied-statistics
reviewer. Its file access was limited to `Read`, `Grep`, and `Glob`. It challenged the
product framing, statistical validity, report/export contract, privacy behavior, migration
sequence, and factual claims about the current repository.

## First-pass verdict

**Conditionally approved as a product direction; not ready to become an implementation
plan.** The reviewer spot-checked 12 implementation claims: 10 were accurate, the arrest
sentinel-coordinate claim was only partially evidenced, and one legacy-label statement was
aspirational.

The blocking findings were:

- Arrest and call reference circles could function as rankings by proxy.
- The shared quasi-Poisson model lacked a defensible arrest/call estimand, not merely
  calibration.
- The two Benjamini-Hochberg pairwise families needed one named winner and a removal date.
- The current trend could not be frozen honestly because it did not match report scope.
- Overlapping buffers and count units lacked enforceable reconciliation rules.
- Arrest subtype vocabulary did not match the imported field semantics.
- Retention, ad-hoc export, coordinate precision, schema support, privacy revalidation,
  checksum scope, adapter removal, assistant parity, and phase ordering needed concrete
  decisions.

## Revision disposition

The proposal was revised to:

- Omit arrest/call reference-circle and modeled-comparison sections at launch.
- Define a measurement target and presentation boundary for each layer.
- Use the reported-incident `/dashboard/compare` candidate-versus-alternatives family as the
  only modeled family and remove Neighborhood's user-facing all-pairs result in Phase 1.
- Exclude the scope-mismatched trend from the canonical artifact.
- Distinguish unique source records from per-place membership, define the internal source
  key, and attach counting metadata to every count.
- Use `arrest_offense_description` and disclose that the imported NIBRS description is not
  necessarily a filed charge.
- Choose client-side ad-hoc export, three-decimal coordinate generalization, a strict export
  allowlist, whole-export blocking for newly sensitive/deleted saved places, and explicit
  privacy-check timestamps.
- Set concrete retention, report-history, deletion, legacy-removal, adapter-exit, assistant,
  and phase-ordering policies.

## Second-pass verdict

**PASS. No remaining blockers.** Opus reported that every prior blocker mapped to a concrete
decision and acceptance criterion and verified 10 newly sampled repository claims.

It offered five non-blocking refinements, all incorporated before handoff:

1. Apply formula escaping to string fields while preserving typed negative numbers.
2. State the offline `report.json` compatibility boundary explicitly.
3. Order Phase 1 through smaller internal gates.
4. Put `privacy_policy_checked_at` in ad-hoc as well as persisted manifests.
5. Keep historical/stale relationship as UI state separate from immutable report status.

An additional local coherence pass tightened the public DTO/envelope boundary, multi-place
terminology, export-wide field allowlist, retention sequencing, freshness vocabulary,
source-record key, date-coverage behavior, and the browser's unavoidable non-revocation
boundary.

## Final delta verdict

Opus re-read the exact post-refinement handoff version and returned **PASS** again. It found
the DTO/envelope split, comparison modes, block-all persisted-report privacy rule, export
allowlist, Phase 1 retention gate, freshness fields, source-record key, date coverage,
string-only formula escaping, and UI/report status separation internally consistent. It
called whole-report blocking after one saved place becomes deleted or sensitive a deliberate
first-release simplicity choice, not a blocker, and judged the proposal ready to convert into
an implementation plan after product approval.
