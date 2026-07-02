# Assistant safety-guard context-scoping (H4 follow-up) — design

**Date:** 2026-07-01 · **Roadmap item:** Phase 4 · H4 follow-up (deferred moderates from PR
#79) · **Status:** approved design, pre-implementation.

## Problem

The H4 PR (#79) shipped a broadened deterministic safety-refusal guard in
`app/assistant/agent.py` (`_SAFETY_SCORE_PATTERN`) — English colloquial place-character terms,
Spanish safety lexicon (adjectives + `-idad` nouns), and Spanish rank-verb→place-noun including
Latin-American variants. An adversarial multi-agent review identified five *moderate* residual
gaps that were deliberately deferred from that PR because each needs **context-scoping** (a
different mechanism from H4's context-free lexicon extension), not just term additions:

1. **Spanish colloquial place-character adjectives** — `tranquilo/a`, `conflictivo/a`,
   `problemático/a`, `mal barrio`. Symmetry gap with the English colloquial arm. `tranquilo`
   also means "calm/quiet" in benign contexts (`estoy tranquilo` = "I'm calm"), so adding it
   context-free would false-trigger on epistemic filler.
2. **`avoid`/`evitar` + place noun** — "Which neighborhoods should I avoid?" / "¿Qué barrios
   debo evitar?" asks the assistant to label places as unsafe. Missing in both languages.
3. **`Estoy seguro` false-trigger** — H4 added bare `seguro`/`segura` (and their `in-` mirrors)
   to the context-free Spanish safety lexicon, but `estoy/estás/está/estar seguro` is Spanish
   for "I'm sure"/"are you sure" (epistemic filler). Legitimate crime-dashboard questions like
   `Estoy seguro que hubo un incidente anoche` over-refuse.
4. **Proper-noun false positives** — "Show incidents near Shady Grove Ave" wrongly trips on
   `Shady`. Same shape for Ghetto Gastro (restaurant), Warsaw Ghetto (historical), Scary
   Cherry (mural tour), Dodgy Dogs (food truck).
5. **Punctuation between rank verb and place noun** — "Rank: my places" / "Clasifica: estos
   barrios" bypass both rank arms because they hard-require `\s+` immediately after the verb.

## Scope

**In scope:** all five findings, in one coherent PR. Findings 1, 3, and 4 all resolve through
the *same* new mechanism (an "ambiguous term + place-context word in the same message" check),
so bundling them is cheaper than piecemeal. Findings 2 and 5 are independent small additions
that would otherwise churn the same tests and imports.

**Out of scope (kept from H4's spec):**
- Languages beyond English/Spanish.
- Message-level co-occurrence *across* turns. The guard already scans each recent user
  message independently (`_recent_user_texts`); the ambiguous+context check is per-message.
- Any change to the assistant's LLM prompt, the redirect text, or the output-guard call site
  beyond swapping the pattern search for the new helper.

## Approach

Chosen: split the current single `_SAFETY_SCORE_PATTERN` into **three regexes plus a small
Python helper**. This is the cleanest expression of the actual logic ("unambiguous term OR
(ambiguous term AND place-context)") and keeps each pattern reasonable in size.

Rejected alternatives:
- **Single mega-regex with lookarounds** (`ambig.{0,60}\bctx\b|\bctx\b.{0,60}ambig`) — same
  file surface, but the pattern grows unreadable and the `.{0,60}` window is a guess.
- **Fix Finding 3 only via negative lookbehind, defer 1 and 4** — smallest change, but
  doesn't address the shared through-line and leaves three related items in a follow-up
  backlog.

### 1 · Pattern structure (`app/assistant/agent.py`)

```python
_UNAMBIGUOUS_SAFETY_PATTERN = re.compile(
    # existing H4 arms MINUS the ambiguous terms extracted below, PLUS the two new
    # unambiguous arms (mal + place-noun compound; avoid/evitar + place noun)
    ...,
    re.IGNORECASE,
)

_AMBIGUOUS_TERM_PATTERN = re.compile(
    # ambiguous-safety-vocabulary lexicon (context-required)
    ...,
    re.IGNORECASE,
)

_PLACE_CONTEXT_PATTERN = re.compile(
    # deictics + place nouns, English + Spanish
    ...,
    re.IGNORECASE,
)

# Back-compat alias so any downstream import of _SAFETY_SCORE_PATTERN keeps working.
_SAFETY_SCORE_PATTERN = _UNAMBIGUOUS_SAFETY_PATTERN


def _contains_safety_ranking(text: str) -> bool:
    if _UNAMBIGUOUS_SAFETY_PATTERN.search(text):
        return True
    return bool(
        _AMBIGUOUS_TERM_PATTERN.search(text) and _PLACE_CONTEXT_PATTERN.search(text)
    )
```

Both existing call sites in `run_assistant_turn` (input guard at line ~72, output guard at
line ~120) switch from `_SAFETY_SCORE_PATTERN.search(...)` to
`_contains_safety_ranking(...)`. Everything else in `agent.py` is untouched.

### 2 · Terms moved to the ambiguous bundle (behavior change)

Now context-required (a place-context word must appear in the same message):

- **English colloquials** (fixes Finding 4): `sketch(?:y|ier|iest)`, `shad(?:y|ier|iest)`,
  `dodg(?:y|ier|iest)`, `seed(?:y|ier|iest)`, `scar(?:y|ier|iest)`, `frightening`, `ghetto`.
- **Spanish safety adjectives** (fixes Finding 3): `segur[oa]s?`, `insegur[oa]s?`.

Still context-free (unchanged from H4):
- **English:** `safe(?:ty|st|r)?`, `unsafe`, `danger(?:ous)?`, `hazard(?:ous)?`,
  `peril(?:ous)?`, `risk(?:y|ier|iest)?`.
- **Spanish nouns:** `seguridad(?:es)?`, `inseguridad(?:es)?`, `peligros(?:[oa]s?|idad(?:es)?)`,
  `peligro`, `riesgos[oa]s?`, `riesgos?`, `arriesgad[oa]s?` (the `-idad` nouns are always
  safety-scoped; the adjective/noun distinction is the exact discriminator).
- **Compound refusals:** `crime-free`, `libre de crimen`.

Regression check: every H4 test's Spanish-adjective phrasing already includes a place-context
word (`zona`, `barrio`, `aquí`, `lugar`, `caminar por aquí`), and every English-colloquial
test includes `area`/`block`/`neighborhood`/`here`/`part of town`. Nothing in H4 regresses;
tests pinned by a meta-test (see the Testing section below).

### 3 · New ambiguous terms (Findings 1 and 2)

Added to the ambiguous bundle:

- **Spanish colloquials (Finding 1):** `tranquil[oa]s?`, `conflictiv[oa]s?`,
  `problem[aá]tic[oa]s?` (accent-tolerant).
- **avoid/evitar (Finding 2):** `avoid(?:s|ed|ing)?`, `evit(?:a|as|ar|ando|ado|ados|ada|adas|en|emos)`.

`tranquilo` alone (`Estoy tranquilo`) does not trip because no place-context word is present.
`¿Es tranquila esta zona?` trips because `zona` is a place-noun context.

Putting avoid/evitar in the ambiguous bundle (rather than the unambiguous arm) is what lets the
guard catch both word orders with one pattern — verb-first ("avoid these places") *and*
object-first ("¿Qué barrios debo evitar?" / "Which neighborhoods should I avoid?"). Both trip
because the ambiguous term and a place-context word co-occur in the same message. `avoid the
pothole` / `evita la lluvia` do not trip because no place-context word is present.

### 4 · New unambiguous arm — the `mal <place-noun>` compound (Finding 1)

The compound literally names a place, so context is baked in — stays in the unambiguous
pattern.

```
\b(?:mal|mala|mal[oa]s)\s+(?:barrio|zona|vecindario|sector|lugar|colonia)s?\b
```

Matches `mal barrio`, `mala zona`, `malos vecindarios`, `mal lugar`, `mal sector`. Does not
match `mal día` / `mala idea` / `malos vecinos` (no place noun).

### 5 · Punctuation between verb and noun (Finding 5)

Change `\s+` after the verb to `[\s,:;\-—]+` on the English rank arm and the Spanish rank
arm. Bounded — no `\W` (avoid matching punctuation-terminated verbs like `Rank!my places`,
which would be spam-shaped and could over-fire).

The avoid/evitar arms live in the ambiguous bundle (no verb-then-noun requirement), so they
inherit this fix for free.

### 6 · Place-context vocabulary (Findings 1, 3, 4)

`_PLACE_CONTEXT_PATTERN` is a Unicode-aware regex with two alternations:

- **English:** `here`, `there`, `around`, `this`, `that`, `these`, `those`, `area`, `block`,
  `neighborhood`, `neighbourhood`, `route`, `street`, `spot`, `option`, `location`, `place`,
  `corner`, `downtown`, `uptown`, `part\s+of\s+town`, `side\s+of\s+town`.
  *`nearby` is deliberately excluded — low-value ("sketchy nearby" is unnatural) and appears
  heavily in restaurant/business copy near proper nouns ("Ghetto Gastro pop-up nearby"),
  which would defeat Finding 4's fix.*
- **Spanish:** `aqu[ií]`, `all[ií]`, `all[aá]`, `ac[aá]`, plus the H4 Spanish place-noun list
  (`zona|barrio|colonia|lugar|sitio|calle|ruta|cuadra|vecindario|sector|distrito|manzana|
  avenida|[aá]rea|ubicaci[oó]n` + plurals + accent-tolerant).

**Why the deictics `this/that/these/those` are safe here:** the ambiguous term must ALSO be
present. `Is this on?` alone does not trip because no ambiguous safety term is present.
`Is this sketchy?` trips because `sketchy` (ambiguous) co-occurs with `this` (context).
That over-triggers on `Is this sketchy chart correct?` — accepted; extremely rare in a crime
dashboard and only produces the redirect, not an invariant leak.

## Data flow

`run_assistant_turn` in `app/assistant/agent.py`:

1. Input guard (pre-LLM): `_asks_for_safety_score(_recent_user_texts(messages))` becomes
   `any(_contains_safety_ranking(text) for text in _recent_user_texts(messages))`. The helper
   `_asks_for_safety_score` is updated internally to use the new check; call site is
   unchanged.
2. Output guard (post-LLM): `_SAFETY_SCORE_PATTERN.search(message)` becomes
   `_contains_safety_ranking(message)`.

No other module changes. `AssistantChatMessage`, `AssistantStreamEvent`, semantic layer,
prompts, tool execution, LLM client — all untouched.

## Error handling / edge cases

- **False-positive boundary is the primary risk.** The moved-to-ambiguous terms are chosen
  precisely because H4 confirmed their false-positive shape (`Shady Grove Ave`, `Estoy seguro
  que…`); the place-context requirement is the fix. New ambiguous Spanish colloquials
  (`tranquilo`) are chosen for the same reason. `frightening` and `ghetto` are added to the
  ambiguous bundle prophylactically — the H4 tests all include place-context, so no
  regression, and it closes the Warsaw Ghetto / Ghetto Gastro shape.
- **Deictic-only triggers cannot fire.** The helper requires *both* ambiguous term AND
  context — a lone `this` does nothing.
- **Unambiguous nouns are the discriminator.** `seguridad` (noun) always signals safety;
  `seguro` (adjective) is ambiguous. Same asymmetry stays for `-idad` nouns vs adjectives.
- **`\b` word boundaries** stay valid across the new patterns (Python `re` treats accented
  characters as word chars in Unicode mode); accent-tolerant classes handle `área`/`area`.

## Testing (TDD)

New/extended cases in `tests/test_assistant_agent.py`:

**Must-trip tests (redirect, zero model calls):**
1. `¿Es tranquila esta zona?`, `¿Este barrio es tranquilo?`, `¿Es un barrio conflictivo?`,
   `¿Es una zona conflictiva?`, `¿Este barrio es problemático?` — Finding 1 (Spanish colloquials).
2. `¿Es un mal barrio?`, `es una mala zona`, `un mal vecindario` — Finding 1 (mal compound).
3. `¿Qué barrios debo evitar?`, `¿Qué zonas deberíamos evitar?`, `evita estos lugares`,
   `Which neighborhoods should I avoid?`, `avoid these places`, `avoiding the area` — Finding 2.
4. `Rank: my places`, `Score, the neighborhoods`, `Rate — these blocks`,
   `Clasifica: estos barrios`, `Puntúa, las rutas` — Finding 5.

**Allow-list tests (reach the model, one LLM call):**
5. `Estoy seguro que hubo un incidente anoche`, `No estoy seguro de la ubicación`,
   `¿Estás seguro que fue anoche?` — Finding 3 (epistemic filler reaches model).
6. `Show incidents near Shady Grove Ave`, `Ghetto Gastro pop-up`, `Dodgy Dogs food truck`,
   `Scary Cherry mural tour`, `How was crime in the Warsaw Ghetto in 1943?` — Finding 4
   (proper nouns reach model).
7. `Estoy tranquilo` (I'm calm), `Estoy tranquila` — Finding 1 allow-list (no place context).
8. `avoid the pothole`, `evita la lluvia` — Finding 2 allow-list (non-place-noun object).

**Regression pin:** a meta-test that every H4 phrasing still trips. Rather than rewriting each
H4 test, the pin lists the H4 must-trip phrasings and iterates, calling `_contains_safety_ranking`
directly.

**Output-side guard tests extended** to cover the new patterns: a model final message
containing an ambiguous term + place-context word (`La zona es tranquila y segura`) is
replaced with the redirect; a message with just `Estoy seguro` is not.

## Verification gate

`make test-all` (pytest + ruff + frontend `npm test` + `npm run build`) from the worktree.
Backend-only change; frontend gate runs per project convention.

## Roadmap tick

On merge, update the "Open — invariant risk" line in `docs/ROADMAP.md`'s maturity snapshot to
note that context-scoping closed Findings 1/2/3/4/5; residual is now only "languages beyond
English/Spanish". No Phase 4 checkbox change (H4 is already ticked).
