# Assistant safety-guard breadth (Phase 4 · H4) — design

**Date:** 2026-07-01 · **Roadmap item:** Phase 4 · H4 (Assistant guard breadth) ·
**Status:** approved design, pre-implementation.

## Problem

The assistant's safety-refusal guard (`_SAFETY_SCORE_PATTERN` in
`app/assistant/agent.py`) is the deterministic backstop for the product invariant: Waypoint
must never score/rank places by safety, danger, or risk. The guard runs on **both** the
incoming user text and the model's final answer, so refusal does not depend on the model.

Two residual gaps remain (roadmap maturity snapshot, "Open — invariant risk"):

1. **English synonym-lexicon breadth.** The lexicon covers `safe*/unsafe/danger*/hazard*/
   peril*/risk*` and `crime-free`, but misses common colloquial "bad-area" adjectives
   (`sketchy`, `shady`, `seedy`, …) that encode the same safety judgment.
2. **Non-English breadth.** The guard is English-only. A Spanish safety-ranking request
   (`¿qué zona es más segura?`, `clasifica estos barrios`) bypasses it entirely.

## Scope

**In scope:** extend the existing deterministic regex in place — broaden the English
colloquial lexicon and add a Spanish arm mirroring both existing arms (safety lexicon +
rank-verb→place-noun). Extend the input- and output-side guard tests.

**Out of scope (explicitly deferred):**
- Any language other than English/Spanish. Non-Latin scripts (CJK, Amharic, …) need
  script-aware matching (no `\b`) and a much larger false-positive review — a separate future
  increment if ever pursued.
- A bilingual redirect message. The UI is English-only; the Spanish arm's job is to *catch
  and refuse*, not to converse in Spanish.
- Refactoring the guard into a per-language lexicon module. Considered and rejected for this
  increment — the regex-in-place change is the smallest diff that closes both gaps.

## Approach

Chosen: **extend the single regex in place** (same architecture, deterministic, no LLM
dependency). Rejected alternatives: a structured per-language lexicon module (more machinery
than a two-language change warrants) and leaning on the LLM prompt to refuse non-English
(violates the "don't depend on the model" backstop principle).

### 1 · English lexicon broadening

Add high-signal colloquial adjectives that describe a *place's* safety character or feel —
the judgment the invariant forbids — and rarely appear in benign incident talk:

> `sketchy`, `shady`, `dodgy`, `seedy`, `scary`, `frightening`, `ghetto`

**Deliberately excluded** to protect the false-positive boundary (these must still reach the
model):
- `violent` / `violence`, `menacing`, `threatening` — event/offense descriptors, not
  place-ranking words. "Were there threatening incidents?" / "violent crime" is legitimate
  incident context.
- `bad` / `good` / `nice` / `best` / `worst` — too broad; "which route is best" (fastest) is a
  legal query.
- `secure` / `security`, `rough`, `avoid` — neutral or routing-legitimate meanings.

### 2 · Spanish arm

Mirror **both** existing arms so a safety-word request and a bare rank request each trip:

- **Safety lexicon:** `seguro`, `inseguro`, `peligroso`, `peligro`, `riesgo`, `arriesgado`,
  `riesgoso` (with gender/number endings `-a/-os/-as` where applicable), plus `libre de
  crimen` (crime-free).
- **Rank arm:** rank verbs `clasificar`, `rankear`, `calificar`, `puntuar` → Spanish place
  nouns `lugar`, `zona`, `barrio`, `área`, `calle`, `ruta`, `sitio`, `cuadra`, `ubicación`
  (+ plurals), through any run of Spanish determiners/possessives (mirrors the English arm's
  determiner-run handling).
- **Accent tolerance:** match both accented and bare forms (`área`/`area`,
  `ubicación`/`ubicacion`), since users routinely type without accents. Coverage is the listed
  lemmas and their gender/number/imperative forms — not full verb conjugation. `\b` remains
  valid — Python `re` treats accented characters as word characters in Unicode mode, so word
  boundaries hold.

### 3 · Redirect text

Unchanged. Both languages resolve to the single English `_SAFETY_REDIRECT`.

## Data flow (unchanged)

`run_assistant_turn` calls `_asks_for_safety_score(_recent_user_texts(messages))` before any
model call (input guard), and re-checks the model's final message with
`_SAFETY_SCORE_PATTERN.search` before streaming (output guard). Only the pattern's contents
change; the two call sites and the redirect behavior are untouched.

## Error handling / edge cases

- **False positives are the primary risk.** Every added term is chosen for low benign-context
  overlap; the ambiguous ones are excluded (above). An explicit allow-list test pins that
  `violent crime`, `best`/`fastest route`, and neutral Spanish incident questions still reach
  the model.
- **Substring safety** (existing property to preserve): word-boundary matching keeps
  `safely`, `Safeway`, `incident rate` from firing. New terms inherit `\b` boundaries; verify
  no term is a common substring of a benign word (e.g. `shady` vs `shade` — distinct;
  `seguro` vs `asegurar` — `\b` prevents the latter matching).

## Testing (TDD)

New/extended cases in `tests/test_assistant_agent.py`, following the established pattern
(redirect streamed, zero model calls):

1. Each new English colloquialism redirects (`Is this a sketchy area?`, etc.).
2. Spanish safety phrasings redirect (`¿Qué zona es más segura?`, `¿Es peligroso este
   barrio?`).
3. Spanish bare-rank phrasing redirects (`Clasifica estos barrios`, `Califica estas zonas`).
4. Accent-free Spanish variants redirect (`que zona es mas segura`, `clasifica estas areas`).
5. **Allow-list (must reach model, one LLM call):** `How many violent crime incidents near
   here?`, `Which route is fastest?`, `¿Cuántos incidentes en esta zona?`.
6. Output-side guard extended: a model final answer containing a new colloquial term or a
   Spanish safety term is replaced with the redirect, not streamed.

## Verification gate

`make test-all` (pytest + ruff + frontend npm test + build) from the worktree. This change is
backend-only (no frontend surface), but the full gate runs per project convention.

## Roadmap tick

On merge, check the H4 box in `docs/ROADMAP.md` and update the maturity-snapshot
"Open — invariant risk" line (English colloquial + Spanish closed; remaining non-English
breadth explicitly deferred).
