# Assistant Safety-Guard Context-Scoping (H4 Follow-Up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 5 moderate findings deferred from H4 (Spanish colloquials, avoid/evitar, `Estoy seguro` false-trigger, proper-noun colloquial false-positives, rank-verb-then-punctuation bypass) by splitting the single H4 regex into three patterns gated by a small Python helper.

**Architecture:** Replace the single `_SAFETY_SCORE_PATTERN` with three cooperating compiled patterns — `_UNAMBIGUOUS_SAFETY_PATTERN`, `_AMBIGUOUS_TERM_PATTERN`, `_PLACE_CONTEXT_PATTERN` — plus a helper `_contains_safety_ranking(text: str) -> bool` that returns True on either an unambiguous hit or a co-occurring (ambiguous term + place-context) hit. Both call sites in `run_assistant_turn` (input guard pre-LLM + output guard post-LLM) swap `_SAFETY_SCORE_PATTERN.search(...)` for the helper. `_SAFETY_SCORE_PATTERN` is kept as a back-compat alias pointing at `_UNAMBIGUOUS_SAFETY_PATTERN`.

**Tech Stack:** Python 3, `re` (Unicode mode — `\w`/`\b` match accented characters), pytest.

**Design reference:** `docs/superpowers/specs/2026-07-01-assistant-guard-context-scoping-design.md`

---

## File Structure

- **Modify:** `app/assistant/agent.py` — replace `_SAFETY_SCORE_PATTERN` (lines 22–53) with three patterns + helper; both call sites (lines ~88 and ~136) swap to the helper.
- **Modify (tests):** `tests/test_assistant_agent.py` — append new must-trip and allow-list cases; add one regression-pin meta-test.
- **Modify (docs, final task):** `docs/ROADMAP.md` — update the "Open — invariant risk" line in the maturity snapshot; no Phase 4 checkbox change (H4 already ticked).

Each task edits the three patterns incrementally. The Task 1 replacement lands the full refactor plus the English-colloquial→ambiguous move (Finding 4) in one shot; Tasks 2–6 add or move terms atomically.

**Target end-state of `_SAFETY_SCORE_PATTERN` region (for reference — Tasks 1–6 build this up):**

```python
_UNAMBIGUOUS_SAFETY_PATTERN = re.compile(
    r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|hazard(?:ous)?|peril(?:ous)?"
    r"|risk(?:y|ier|iest)?)\b"
    r"|\bcrime[-\s]free\b"
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*)[\s,:;\-—]+"
    r"(?:(?:the|these|those|this|that|them|my|your|our|their|its|his|her|a|an|all|both"
    r"|any|some|each|every)\s+)*"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b"
    r"|\b(?:seguridad(?:es)?|inseguridad(?:es)?"
    r"|peligros(?:[oa]s?|idad(?:es)?)|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
    r"|\blibre\s+de\s+crimen\b"
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*[\s,:;\-—]+"
    r"(?:(?:el|la|los|las|este|esta|estos|estas|ese|esa|esos|esas|mi|mis|tu|tus|su|sus"
    r"|un|una|unos|unas|todo|toda|todos|todas|cada)\s+)*"
    r"(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b"
    r"|\b(?:mal|mala|mal[oa]s)\s+(?:barrio|zona|vecindario|sector|lugar|colonia)s?\b",
    re.IGNORECASE,
)

_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?|avoid(?:s|ed|ing)?"
    r"|evit(?:a|as|ar|ando|ado|ados|ada|adas|en|emos))\b",
    re.IGNORECASE,
)

_PLACE_CONTEXT_PATTERN = re.compile(
    r"\b(?:here|there|around|this|that|these|those|area|block"
    r"|neighbou?rhood|route|street|spot|option|location|place|corner"
    r"|downtown|uptown|part\s+of\s+town|side\s+of\s+town)s?\b"
    r"|\b(?:aqu[ií]|all[ií]|all[aá]|ac[aá])\b"
    r"|\b(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b",
    re.IGNORECASE,
)

_SAFETY_SCORE_PATTERN = _UNAMBIGUOUS_SAFETY_PATTERN  # back-compat alias


def _contains_safety_ranking(text: str) -> bool:
    if _UNAMBIGUOUS_SAFETY_PATTERN.search(text):
        return True
    return bool(
        _AMBIGUOUS_TERM_PATTERN.search(text)
        and _PLACE_CONTEXT_PATTERN.search(text)
    )
```

---

## Task 1: Refactor + move English colloquials to ambiguous bundle (Finding 4)

Lands the whole three-pattern architecture and simultaneously fixes proper-noun false positives (`Shady Grove Ave`, `Warsaw Ghetto`) by making the English colloquial terms context-required.

**Files:**
- Modify: `app/assistant/agent.py` (lines 22-53, 88, 136-137, 151-152)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing test — proper-noun false positives**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_agent_does_not_redirect_english_colloquial_proper_nouns(tmp_path):
    # H4 follow-up · Finding 4: English colloquial terms (sketchy/shady/dodgy/seedy/scary/
    # ghetto/frightening) are now context-required — they must NOT trip the guard when they
    # appear as proper nouns without a place-context word.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Show incidents near Shady Grove Ave",
        "Ghetto Gastro pop-up nearby",
        "Dodgy Dogs food truck schedule",
        "Scary Cherry mural tour dates",
        "How was crime in the Warsaw Ghetto in 1943?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing  # reached the model, not the redirect
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_does_not_redirect_english_colloquial_proper_nouns -v`
Expected: FAIL — first phrasing `Show incidents near Shady Grove Ave` currently trips the guard on bare `Shady`, so `client.calls == []` and the assertion `len(client.calls) == 1` fails.

- [ ] **Step 3: Refactor `app/assistant/agent.py` — introduce three patterns + helper**

Replace lines 22-53 in `app/assistant/agent.py` (the comment block plus `_SAFETY_SCORE_PATTERN`) with this:

```python
# Reject requests that ask the assistant to score/rank places by safety, danger, or risk —
# the product invariant forbids it. The guard is split into three cooperating patterns:
#   1. _UNAMBIGUOUS_SAFETY_PATTERN — terms that alone signal a safety-ranking ask (safe,
#      dangerous, seguridad, peligroso, "crime-free", the rank/rate/score verb arms, the
#      "mal + place-noun" compound, ...). A hit here trips the guard on its own.
#   2. _AMBIGUOUS_TERM_PATTERN — colloquial/adjectival terms that ALSO have benign senses
#      ("sketchy" as a proper noun; "seguro" as "I'm sure"; "tranquilo" as "calm"). These
#      only trip if _PLACE_CONTEXT_PATTERN also matches the same message.
#   3. _PLACE_CONTEXT_PATTERN — deictics + place nouns in English and Spanish.
# Event/offense descriptors ("violent", "threatening", "menacing") are deliberately excluded
# — they are legitimate incident context, not place-ranking words. Word-boundary matching
# keeps legitimate substrings ("safely", "Safeway", "incident rate") and allowed count
# framing ("which area has the most crime") from false-triggering. The guard runs on BOTH
# the incoming user text and the model's final answer (see run_assistant_turn).
_UNAMBIGUOUS_SAFETY_PATTERN = re.compile(
    r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|hazard(?:ous)?|peril(?:ous)?"
    r"|risk(?:y|ier|iest)?)\b"
    r"|\bcrime[-\s]free\b"
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*)\s+"
    r"(?:(?:the|these|those|this|that|them|my|your|our|their|its|his|her|a|an|all|both"
    r"|any|some|each|every)\s+)*"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b"
    r"|\b(?:segur(?:[oa]s?|idad(?:es)?)|insegur(?:[oa]s?|idad(?:es)?)"
    r"|peligros(?:[oa]s?|idad(?:es)?)|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
    r"|\blibre\s+de\s+crimen\b"
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*\s+"
    r"(?:(?:el|la|los|las|este|esta|estos|estas|ese|esa|esos|esas|mi|mis|tu|tus|su|sus"
    r"|un|una|unos|unas|todo|toda|todos|todas|cada)\s+)*"
    r"(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b",
    re.IGNORECASE,
)

_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto)\b",
    re.IGNORECASE,
)

_PLACE_CONTEXT_PATTERN = re.compile(
    r"\b(?:here|there|around|this|that|these|those|area|block"
    r"|neighbou?rhood|route|street|spot|option|location|place|corner"
    r"|downtown|uptown|part\s+of\s+town|side\s+of\s+town)s?\b",
    re.IGNORECASE,
)

# Back-compat alias — downstream imports (and the output-guard test) still work.
_SAFETY_SCORE_PATTERN = _UNAMBIGUOUS_SAFETY_PATTERN
```

*Note:* the Spanish safety arm above preserves H4's current form (adjectives + `-idad` nouns together). Task 2 narrows the two adjective disjuncts to nouns only when it moves the adjectives to the ambiguous bundle.

Then replace `_asks_for_safety_score` to use the new helper. Replace:

```python
def _asks_for_safety_score(texts: Iterable[str]) -> bool:
    return any(_SAFETY_SCORE_PATTERN.search(text) for text in texts)
```

with:

```python
def _asks_for_safety_score(texts: Iterable[str]) -> bool:
    return any(_contains_safety_ranking(text) for text in texts)


def _contains_safety_ranking(text: str) -> bool:
    if _UNAMBIGUOUS_SAFETY_PATTERN.search(text):
        return True
    return bool(
        _AMBIGUOUS_TERM_PATTERN.search(text)
        and _PLACE_CONTEXT_PATTERN.search(text)
    )
```

Finally, update the output-guard call site (line 136). Replace:

```python
    if _SAFETY_SCORE_PATTERN.search(message):
        message = _SAFETY_REDIRECT
```

with:

```python
    if _contains_safety_ranking(message):
        message = _SAFETY_REDIRECT
```

- [ ] **Step 4: Run the failing test — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_does_not_redirect_english_colloquial_proper_nouns -v`
Expected: PASS — `Shady` alone no longer trips because no place-context word (`here`/`area`/`block`/etc.) appears in `Show incidents near Shady Grove Ave`.

- [ ] **Step 5: Run the full guard test file — no regressions**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py -v`
Expected: all pre-existing tests PASS. This proves the refactor is behavior-preserving for the H4 test surface. (The existing English colloquial tests like `Is this a sketchy area?` still trip because `area`/`block`/`neighborhood`/`here`/`part of town` are all in `_PLACE_CONTEXT_PATTERN`.)

- [ ] **Step 6: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "refactor(assistant): split guard into 3 patterns + context-scope English colloquials"
```

---

## Task 2: Move Spanish `seguro`/`inseguro` to ambiguous bundle (Finding 3)

**Files:**
- Modify: `app/assistant/agent.py` (`_UNAMBIGUOUS_SAFETY_PATTERN` Spanish safety line + `_AMBIGUOUS_TERM_PATTERN` + `_PLACE_CONTEXT_PATTERN`)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing test — `Estoy seguro` reaches the model**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_agent_does_not_redirect_spanish_epistemic_filler(tmp_path):
    # H4 follow-up · Finding 3: bare Spanish "seguro"/"segura" as epistemic filler
    # ("I'm sure"/"are you sure") must reach the model. These are common conversational
    # forms with no place-context; they are the direct Spanish analog of "safely"/"Safeway"
    # the English arm already avoids.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Estoy seguro que hubo un incidente anoche",
        "No estoy seguro de la fecha",
        "¿Estás seguro que fue anoche?",
        "Seguro que hay muchos incidentes",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing  # reached the model, not the redirect
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_does_not_redirect_spanish_epistemic_filler -v`
Expected: FAIL — `seguro` currently sits in `_UNAMBIGUOUS_SAFETY_PATTERN` (via `segur(?:[oa]s?|idad(?:es)?)`), so all four phrasings trip the guard.

- [ ] **Step 3: Narrow the unambiguous Spanish safety arm to `-idad` nouns only, add adjectives to the ambiguous bundle, and add Spanish place-context**

In `app/assistant/agent.py`, in `_UNAMBIGUOUS_SAFETY_PATTERN`, narrow the leading two disjuncts (adjective + noun) to nouns only. Replace:

```python
    r"|\b(?:segur(?:[oa]s?|idad(?:es)?)|insegur(?:[oa]s?|idad(?:es)?)"
    r"|peligros(?:[oa]s?|idad(?:es)?)|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
```

with:

```python
    r"|\b(?:seguridad(?:es)?|inseguridad(?:es)?"
    r"|peligros(?:[oa]s?|idad(?:es)?)|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
```

Then extend `_AMBIGUOUS_TERM_PATTERN` — replace:

```python
_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto)\b",
    re.IGNORECASE,
)
```

with:

```python
_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?)\b",
    re.IGNORECASE,
)
```

Then extend `_PLACE_CONTEXT_PATTERN` with Spanish deictics + Spanish place nouns. Replace:

```python
_PLACE_CONTEXT_PATTERN = re.compile(
    r"\b(?:here|there|around|this|that|these|those|area|block"
    r"|neighbou?rhood|route|street|spot|option|location|place|corner"
    r"|downtown|uptown|part\s+of\s+town|side\s+of\s+town)s?\b",
    re.IGNORECASE,
)
```

with:

```python
_PLACE_CONTEXT_PATTERN = re.compile(
    r"\b(?:here|there|around|this|that|these|those|area|block"
    r"|neighbou?rhood|route|street|spot|option|location|place|corner"
    r"|downtown|uptown|part\s+of\s+town|side\s+of\s+town)s?\b"
    r"|\b(?:aqu[ií]|all[ií]|all[aá]|ac[aá])\b"
    r"|\b(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b",
    re.IGNORECASE,
)
```

- [ ] **Step 4: Run failing test — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_does_not_redirect_spanish_epistemic_filler -v`
Expected: PASS — `seguro` is now ambiguous, and no place-context word (Spanish deictic or place noun) appears in the four epistemic-filler phrasings.

- [ ] **Step 5: Run the full guard test file — no regressions**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py -v`
Expected: all pre-existing tests PASS. The H4 Spanish adjective tests all trip because they contain `zona`/`barrio`/`aquí`/`lugar` (place-context words).

- [ ] **Step 6: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): context-scope Spanish seguro/inseguro (H4 followup)"
```

---

## Task 3: Add Spanish colloquial adjectives to ambiguous bundle (Finding 1a)

**Files:**
- Modify: `app/assistant/agent.py` (`_AMBIGUOUS_TERM_PATTERN`)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing tests**

Append these functions to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_spanish_colloquial_place_adjectives(tmp_path):
    # H4 follow-up · Finding 1a: Spanish colloquial place-character adjectives
    # (tranquilo/a, conflictivo/a, problemático/a) that describe a place must trip the guard
    # when a place-context word co-occurs. Symmetry with the English colloquial arm.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Es tranquila esta zona?",
        "¿Este barrio es tranquilo?",
        "¿Es un barrio conflictivo?",
        "¿Es una zona conflictiva?",
        "¿Este barrio es problemático?",
        "¿Es problemática esta zona?",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert [event.event for event in events] == ["meta", "token", "done"], phrasing
            assert "reported incident" in events[1].data["delta"], phrasing
            assert client.calls == [], phrasing
    finally:
        session.close()


def test_agent_does_not_redirect_spanish_colloquial_filler(tmp_path):
    # H4 follow-up · Finding 1a allow-list: bare "tranquilo"/"tranquila" as personal state
    # ("I'm calm") must reach the model — same filler shape as "estoy seguro".
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Estoy tranquilo",
        "Estoy tranquila",
        "Mantente tranquilo, por favor",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_colloquial_place_adjectives tests/test_assistant_agent.py::test_agent_does_not_redirect_spanish_colloquial_filler -v`
Expected: `test_agent_redirects_spanish_colloquial_place_adjectives` FAILS (terms not in pattern yet). The allow-list test may PASS accidentally (nothing matches). That's OK — we still need the trip test to fail first.

- [ ] **Step 3: Add colloquial adjectives to `_AMBIGUOUS_TERM_PATTERN`**

In `app/assistant/agent.py`, replace:

```python
_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?)\b",
    re.IGNORECASE,
)
```

with:

```python
_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?)\b",
    re.IGNORECASE,
)
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_colloquial_place_adjectives tests/test_assistant_agent.py::test_agent_does_not_redirect_spanish_colloquial_filler -v`
Expected: both PASS. The must-trip test now trips (each phrasing has `zona`/`barrio` place-context); the allow-list test still passes (no place-context word in "Estoy tranquilo").

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): guard Spanish colloquial place adjectives (H4 followup)"
```

---

## Task 4: Add `mal <place-noun>` unambiguous compound (Finding 1b)

**Files:**
- Modify: `app/assistant/agent.py` (`_UNAMBIGUOUS_SAFETY_PATTERN` — append a new arm)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing tests**

Append these functions to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_spanish_mal_place_compound(tmp_path):
    # H4 follow-up · Finding 1b: "mal barrio"/"mala zona"/"malos vecindarios" are compound
    # judgments with the place noun baked in — unambiguous safety-ranking language, must trip.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Es un mal barrio?",
        "Es una mala zona",
        "Es un mal vecindario",
        "Son malos barrios",
        "Es un mal sector",
        "Es un mal lugar",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert [event.event for event in events] == ["meta", "token", "done"], phrasing
            assert "reported incident" in events[1].data["delta"], phrasing
            assert client.calls == [], phrasing
    finally:
        session.close()


def test_agent_does_not_redirect_mal_without_place_noun(tmp_path):
    # H4 follow-up · Finding 1b allow-list: "mal + non-place-noun" must reach the model
    # (mala idea = bad idea, mal día = bad day, malos vecinos = bad neighbors — none are
    # place nouns even though "vecinos" is close to "vecindario").
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Fue una mala idea",
        "Un mal día",
        "Tengo malos vecinos",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()
```

- [ ] **Step 2: Run tests to verify the must-trip fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_mal_place_compound tests/test_assistant_agent.py::test_agent_does_not_redirect_mal_without_place_noun -v`
Expected: `test_agent_redirects_spanish_mal_place_compound` FAILS — no arm currently matches `mal barrio`. The allow-list test passes trivially.

- [ ] **Step 3: Append the `mal <place-noun>` arm to `_UNAMBIGUOUS_SAFETY_PATTERN`**

In `app/assistant/agent.py`, in the `_UNAMBIGUOUS_SAFETY_PATTERN` block, replace the final line (the closing `re.IGNORECASE,` after `ubicaci[oó]n(?:es)?)\b"`):

```python
    r"(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b",
    re.IGNORECASE,
)
```

with:

```python
    r"(?:(?:lugar|sector)(?:es)?"
    r"|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra|colonia|vecindario"
    r"|distrito|manzana|avenida)s?"
    r"|ubicaci[oó]n(?:es)?)\b"
    r"|\b(?:mal|mala|mal[oa]s)\s+(?:barrio|zona|vecindario|sector|lugar|colonia)s?\b",
    re.IGNORECASE,
)
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_mal_place_compound tests/test_assistant_agent.py::test_agent_does_not_redirect_mal_without_place_noun -v`
Expected: both PASS. `mal barrio` / `mala zona` etc. trip via the new arm; `mala idea` / `mal día` / `malos vecinos` don't match (not in the place-noun list).

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): guard Spanish 'mal + place-noun' compound (H4 followup)"
```

---

## Task 5: Add avoid/evitar to ambiguous bundle (Finding 2)

**Files:**
- Modify: `app/assistant/agent.py` (`_AMBIGUOUS_TERM_PATTERN`)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing tests**

Append these functions to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_avoid_evitar_place_requests(tmp_path):
    # H4 follow-up · Finding 2: asking which places to avoid ("¿Qué barrios debo evitar?" /
    # "Which neighborhoods should I avoid?") is asking the assistant to label places unsafe.
    # Both word orders (object-first and verb-first) trip via the ambiguous+context helper.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Qué barrios debo evitar?",
        "¿Qué zonas deberíamos evitar?",
        "evita estos lugares",
        "Which neighborhoods should I avoid?",
        "avoid these places",
        "avoiding the area at night",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert [event.event for event in events] == ["meta", "token", "done"], phrasing
            assert "reported incident" in events[1].data["delta"], phrasing
            assert client.calls == [], phrasing
    finally:
        session.close()


def test_agent_does_not_redirect_avoid_without_place_context(tmp_path):
    # H4 follow-up · Finding 2 allow-list: "avoid the pothole" / "evita la lluvia" are not
    # place-ranking asks — no place-context word appears, so the ambiguous+context check
    # must NOT trip.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "How do I avoid the pothole?",
        "evita la lluvia",
        "avoid gluten in your diet",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"Here is the reported context."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert len(client.calls) == 1, phrasing
            assert events[1].data["delta"] == "Here is the reported context.", phrasing
    finally:
        session.close()
```

- [ ] **Step 2: Run tests to verify the must-trip fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_avoid_evitar_place_requests tests/test_assistant_agent.py::test_agent_does_not_redirect_avoid_without_place_context -v`
Expected: `test_agent_redirects_avoid_evitar_place_requests` FAILS — `avoid`/`evit-` are not yet in any pattern.

- [ ] **Step 3: Add avoid/evitar to `_AMBIGUOUS_TERM_PATTERN`**

In `app/assistant/agent.py`, replace:

```python
_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?)\b",
    re.IGNORECASE,
)
```

with:

```python
_AMBIGUOUS_TERM_PATTERN = re.compile(
    r"\b(?:sketch(?:y|ier|iest)|shad(?:y|ier|iest)|dodg(?:y|ier|iest)"
    r"|seed(?:y|ier|iest)|scar(?:y|ier|iest)|frightening|ghetto"
    r"|segur[oa]s?|insegur[oa]s?|tranquil[oa]s?|conflictiv[oa]s?"
    r"|problem[aá]tic[oa]s?|avoid(?:s|ed|ing)?"
    r"|evit(?:a|as|ar|ando|ado|ados|ada|adas|en|emos))\b",
    re.IGNORECASE,
)
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_avoid_evitar_place_requests tests/test_assistant_agent.py::test_agent_does_not_redirect_avoid_without_place_context -v`
Expected: both PASS. Object-first (`¿Qué barrios debo evitar?`) and verb-first (`evita estos lugares`) both trip because both a term and a place-context word appear in the same message.

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): guard avoid/evitar + place requests (H4 followup)"
```

---

## Task 6: Punctuation between rank verb and place noun (Finding 5)

**Files:**
- Modify: `app/assistant/agent.py` (English rank arm + Spanish rank arm in `_UNAMBIGUOUS_SAFETY_PATTERN`)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing test**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_rank_verb_with_punctuation_before_noun(tmp_path):
    # H4 follow-up · Finding 5: directive-style rank/rate/score with punctuation ("Rank: my
    # places", "Clasifica: estos barrios", "Score, the neighborhoods") bypasses the H4 arms
    # because they hard-require \s+ right after the verb. Widen to a bounded punctuation class.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Rank: my places",
        "Score, the neighborhoods",
        "Rate — these blocks",
        "Clasifica: estos barrios",
        "Puntúa, las rutas",
    ]
    try:
        for phrasing in phrasings:
            client = FakeClient(['{"type":"final","message":"OK."}'])
            events = asyncio.run(
                _collect(
                    session,
                    user_hash,
                    [AssistantChatMessage(role="user", content=phrasing)],
                    AssistantDashboardState(selected_place_ids=["place-1"]),
                    client,
                )
            )
            assert [event.event for event in events] == ["meta", "token", "done"], phrasing
            assert "reported incident" in events[1].data["delta"], phrasing
            assert client.calls == [], phrasing
    finally:
        session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_rank_verb_with_punctuation_before_noun -v`
Expected: FAIL — every phrasing bypasses because the current arms require `\s+` after the verb.

- [ ] **Step 3: Widen the separator class on both rank arms**

In `app/assistant/agent.py`, in `_UNAMBIGUOUS_SAFETY_PATTERN`, replace the English rank arm line:

```python
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*)\s+"
```

with:

```python
    r"|\b(?:rank\w*|rat[ei]\w*|scor[ei]\w*)[\s,:;\-—]+"
```

and replace the Spanish rank arm line:

```python
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*\s+"
```

with:

```python
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*[\s,:;\-—]+"
```

- [ ] **Step 4: Run the failing test — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_rank_verb_with_punctuation_before_noun -v`
Expected: PASS — all five phrasings now trip.

- [ ] **Step 5: Run the full guard file — no regressions on space-separated rank phrasings**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py -v`
Expected: all tests PASS. `[\s,:;\-—]+` still matches `\s+` (space is in the class), so all H4 space-separated rank tests still trip.

- [ ] **Step 6: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): allow punctuation between rank verb and place noun (H4 followup)"
```

---

## Task 7: Regression-pin meta-test for H4 phrasings

Guarantees that every H4-era must-trip phrasing still trips through `_contains_safety_ranking`, and that H4-era allow-list phrasings still reach the model. Complements the tests already in the file — this one exercises the helper directly, so it survives future refactors of the call sites.

**Files:**
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Add the meta-test**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_h4_phrasings_still_covered_by_helper():
    # H4 follow-up regression pin: the context-scoping refactor must not regress the H4-era
    # phrasings the guard already caught. Direct helper-level check (no session / no LLM).
    from app.assistant.agent import _contains_safety_ranking

    must_trip = [
        # H4 English safety lexicon
        "Which place is safest?",
        "How risky is this area?",
        "Rank these places by safety.",
        "Is this a sketchy area?",
        "Is that block shady?",
        "Which block is the sketchiest?",
        # H4 Spanish safety lexicon (still tripping because place-context is present)
        "¿Qué zona es más segura?",
        "¿Es peligroso este barrio?",
        "¿Es inseguro caminar por aquí?",
        "que lugar es mas seguro",
        "¿Cuál es la seguridad de esta zona?",
        # H4 Spanish rank arm + LatAm variants
        "Clasifica estos barrios",
        "clasifica estas colonias",
        # H4 English rank arm + inflections
        "Rate these blocks",
        "Ranking my neighborhoods",
    ]
    must_pass = [
        # H4 allow-list — neutral/legit incident-context questions
        "What is the reported incident rate near place-1?",
        "Which area has the most crime?",
        "How many violent crime incidents near here?",
        "¿Cuántos incidentes en esta zona?",
        "¿Cuál es la ruta más rápida?",
    ]
    for phrasing in must_trip:
        assert _contains_safety_ranking(phrasing), phrasing
    for phrasing in must_pass:
        assert not _contains_safety_ranking(phrasing), phrasing
```

- [ ] **Step 2: Run the test — expect PASS**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_h4_phrasings_still_covered_by_helper -v`
Expected: PASS. If any phrasing fails, the failure message names the specific string, so the diff is obvious.

- [ ] **Step 3: Commit**

```bash
git add tests/test_assistant_agent.py
git commit -m "test(assistant): pin H4 phrasings against the context-scoped helper"
```

---

## Task 8: Full verification gate + roadmap update + push + PR

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run the full verification gate**

Run: `make test-all`
Expected: pytest + `ruff check .` + frontend `npm test` + `npm run build` all pass. Backend-only change; frontend gate runs per project convention.

- [ ] **Step 2: Update the ROADMAP "Open — invariant risk" line**

In `docs/ROADMAP.md`, replace the maturity-snapshot row:

```markdown
| **Open — invariant risk** | Safety-refusal guard hardened (object-first regex gap fixed #59; output-side guard + broadened ranking/determiner detection #63; English colloquial lexicon + Spanish arm added, H4). Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching) — deferred future increment |
```

with:

```markdown
| **Open — invariant risk** | Safety-refusal guard hardened (object-first regex gap fixed #59; output-side guard + broadened ranking/determiner detection #63; H4: English colloquial lexicon + Spanish arm + LatAm place nouns; H4 follow-up: context-scoping — Spanish colloquials `tranquilo`/`conflictivo`/`problemático`, `mal + place-noun`, avoid/evitar, `Estoy seguro` epistemic filler, proper-noun colloquials, rank-verb punctuation). Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching) — deferred future increment |
```

Also update the H4 line in `Phase 4 — Harden & polish` — replace:

```markdown
- [x] **H4 · Assistant guard breadth** — shipped: broadened the deterministic guard's English lexicon with colloquial place-character terms (`sketchy`/`shady`/`dodgy`/`seedy`/`scary`/`frightening`/`ghetto`, plus their comparative/superlative forms) and English rank-verb inflections (`ranking`/`rated`/`scoring`), and added a Spanish mirror of both arms — safety lexicon (`seguro`/`peligroso`/`riesgo`/… + the `-idad` nouns `seguridad`/`inseguridad`/`peligrosidad`) + rank-verb→place-noun including Latin-American place nouns (`colonia`/`vecindario`/`sector`/`distrito`/`manzana`/`avenida`), accent-tolerant. Event/offense descriptors (`violent`/`threatening`/`menacing`) stay excluded as legitimate incident context. Residual: languages beyond English/Spanish, plus Spanish colloquials (`tranquilo`/`conflictivo`) and `avoid`/`evitar` + place — deferred as follow-up increments (they need context-scoping to add without false positives). Spec/plan: `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-breadth*`.
```

with:

```markdown
- [x] **H4 · Assistant guard breadth** — shipped in two increments. **Inc 1 (#79):** broadened the deterministic guard's English lexicon with colloquial place-character terms (`sketchy`/`shady`/`dodgy`/`seedy`/`scary`/`frightening`/`ghetto`, plus their comparative/superlative forms) and English rank-verb inflections (`ranking`/`rated`/`scoring`), and added a Spanish mirror of both arms — safety lexicon (`seguro`/`peligroso`/`riesgo`/… + the `-idad` nouns `seguridad`/`inseguridad`/`peligrosidad`) + rank-verb→place-noun including Latin-American place nouns (`colonia`/`vecindario`/`sector`/`distrito`/`manzana`/`avenida`), accent-tolerant. Event/offense descriptors (`violent`/`threatening`/`menacing`) stay excluded as legitimate incident context. **Inc 2 (H4 follow-up):** split the single regex into three cooperating patterns (`_UNAMBIGUOUS_SAFETY_PATTERN`, `_AMBIGUOUS_TERM_PATTERN`, `_PLACE_CONTEXT_PATTERN`) gated by a `_contains_safety_ranking` helper; closes Spanish colloquials (`tranquilo`/`conflictivo`/`problemático`), the `mal + place-noun` compound, avoid/evitar + place (both word orders), the `Estoy seguro` epistemic-filler false-trigger, proper-noun colloquial false-positives (`Shady Grove Ave`, `Warsaw Ghetto`), and rank-verb-then-punctuation bypass. Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching) — deferred future increment. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-breadth*` and `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-context-scoping*`.
```

- [ ] **Step 3: Commit the roadmap tick**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): H4 follow-up — context-scoped safety guard (Inc 2)"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin h4-guard-context
gh pr create --base main --title "feat(assistant): safety-guard context-scoping (H4 follow-up)" --body "$(cat <<'EOF'
## Summary
Closes the five moderate findings deferred from the H4 PR (#79). Splits the single H4 regex into three cooperating patterns — `_UNAMBIGUOUS_SAFETY_PATTERN`, `_AMBIGUOUS_TERM_PATTERN`, `_PLACE_CONTEXT_PATTERN` — gated by a `_contains_safety_ranking(text)` helper. Ambiguous terms (English colloquials, Spanish adjectives, `tranquilo`/`conflictivo`/`problemático`, `avoid`/`evitar`) only trip when a place-context word co-occurs in the same message.

**Fixes:**
- Spanish colloquials `tranquilo`/`conflictivo`/`problemático` + `mal barrio` compound (Finding 1).
- `avoid`/`evitar` + place noun, both word orders (Finding 2).
- `Estoy seguro que…` epistemic-filler false-trigger (Finding 3).
- Proper-noun colloquial false-positives — `Shady Grove Ave`, `Warsaw Ghetto`, `Ghetto Gastro`, etc. (Finding 4).
- Rank-verb-then-punctuation bypass — `Rank: my places`, `Clasifica: estos barrios` (Finding 5).

Architecture unchanged: deterministic, no LLM dependency, same two call sites. Backend-only.

## Tests
New must-trip and allow-list cases in `tests/test_assistant_agent.py` for each finding. Regression pin verifies every H4 phrasing still trips through the helper. `make test-all` green.

Spec/plan: `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-context-scoping*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Order matters:** Task 1 lands the whole refactor architecture *and* the English-colloquial move together (they touch the same code region and share test surface). Subsequent tasks each move or add one thing.
- **`\b` word boundaries + Unicode:** Python's `re` is Unicode-aware by default. `\b` treats accented characters (`á`, `ó`, `ñ`) as word characters — so `[aá]rea` and `ubicaci[oó]n` both anchor cleanly with `\b`, and `re.IGNORECASE` covers capitalization.
- **The bounded punctuation class `[\s,:;\-—]+`:** the `\-` escape guards against character-class ranges; `—` is the em-dash (U+2014). `\W+` would over-match punctuation-terminated verbs like `Rank!my places`.
- **The ambiguous+context check is per-message.** Each entry in `_recent_user_texts(messages)` is passed to `_contains_safety_ranking` separately (existing `_asks_for_safety_score` semantics). Cross-turn co-occurrence (safety word in turn N-2, place word in turn N) is deliberately out of scope — the spec calls this out.
- **Tool summaries are not affected** — the output guard runs on the free-form `final` message path only, not on `build_tool_summary` output. Widening the pattern cannot corrupt deterministic analysis summaries.
- **`_SAFETY_SCORE_PATTERN` alias:** kept so any downstream import (including a test that imports it directly) does not break. It resolves to `_UNAMBIGUOUS_SAFETY_PATTERN`, which behaves identically for the "unambiguous safety text" scan.
