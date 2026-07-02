# Assistant Safety-Guard Breadth (Phase 4 · H4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the residual synonym-lexicon (English colloquialisms) and non-English (Spanish) gaps in the deterministic safety-refusal guard, extending the single regex in place.

**Architecture:** The guard is one `re` pattern, `_SAFETY_SCORE_PATTERN` in `app/assistant/agent.py`, checked on both incoming user text (input guard, pre-LLM) and the model's free-form final answer (output guard). This change only edits the pattern's contents plus its explanatory comment; the two call sites, the redirect text, and all other behavior are untouched. Tool-summary answers do not pass through this pattern, so widening it only affects user questions and free-form model answers.

**Tech Stack:** Python 3, `re` (Unicode mode — `\w`/`\b` match accented characters), pytest.

**Design reference:** `docs/superpowers/specs/2026-07-01-assistant-guard-breadth-design.md`

---

## File Structure

- **Modify:** `app/assistant/agent.py` — the `_SAFETY_SCORE_PATTERN` regex (lines ~28-37) and its preceding comment (lines ~22-27). No other file changes in the implementation tasks.
- **Modify (tests):** `tests/test_assistant_agent.py` — append new guard tests alongside the existing `test_agent_redirects_*` / `test_agent_does_not_redirect_*` family.
- **Modify (docs, final task):** `docs/ROADMAP.md` — tick H4 and update the maturity-snapshot invariant-risk line.

Each task edits the same regex atom incrementally by concatenating one more raw-string arm. The current pattern for reference:

```python
_SAFETY_SCORE_PATTERN = re.compile(
    r"\b(?:safe(?:ty|st|r)?|unsafe|danger(?:ous)?|hazard(?:ous)?|peril(?:ous)?"
    r"|risk(?:y|ier|iest)?)\b"
    r"|\bcrime[-\s]free\b"
    r"|\b(?:rank|rate|score)\b\s+"
    r"(?:(?:the|these|those|this|that|them|my|your|our|their|its|his|her|a|an|all|both"
    r"|any|some|each|every)\s+)*"
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b",
    re.IGNORECASE,
)
```

---

## Task 1: English colloquial "bad-area" adjectives

**Files:**
- Modify: `app/assistant/agent.py` (the `_SAFETY_SCORE_PATTERN` first lexicon arm + comment)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing test**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_colloquial_area_judgment_terms(tmp_path):
    # H4: colloquial adjectives that judge a *place's* safety character must trip the guard
    # before any model call. (Event/offense descriptors like "threatening" are deliberately
    # NOT here — see test_agent_does_not_redirect_neutral_spanish_or_incident_terms.)
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Is this a sketchy area?",
        "Is that block shady?",
        "That neighborhood seems dodgy.",
        "Is downtown seedy?",
        "Is it scary here at night?",
        "Is this a frightening part of town?",
        "Is this a ghetto neighborhood?",
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

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_colloquial_area_judgment_terms -v`
Expected: FAIL — first phrasing reaches the model (`client.calls` is non-empty / `AssertionError`), because `sketchy` etc. are not yet in the pattern.

- [ ] **Step 3: Write minimal implementation**

In `app/assistant/agent.py`, replace the first lexicon line:

```python
    r"|risk(?:y|ier|iest)?)\b"
```

with (adds the seven place-character adjectives inside the same alternation group):

```python
    r"|risk(?:y|ier|iest)?|sketchy|shady|dodgy|seedy|scary|frightening|ghetto)\b"
```

Then update the comment block above the pattern to name the colloquial arm. Replace:

```python
# Reject requests that ask the assistant to score/rank places by safety, danger, or risk —
# the product invariant forbids it. Two arms: (1) a safety-vocabulary lexicon, and (2) a
# rank/rate/score verb followed (through any run of determiners/possessives) by a place noun.
# Word-boundary matching keeps legitimate substrings ("safely", "Safeway", "incident rate")
# and allowed count framing ("which area has the most crime") from false-triggering. The guard
# runs on BOTH the incoming user text and the model's final answer (see run_assistant_turn).
```

with:

```python
# Reject requests that ask the assistant to score/rank places by safety, danger, or risk —
# the product invariant forbids it. Arms: (1) an English safety-vocabulary lexicon (including
# colloquial place-character slang like "sketchy"/"shady"), (2) an English rank/rate/score
# verb followed (through any run of determiners/possessives) by a place noun, and (3+4) the
# Spanish mirrors of both. Event/offense descriptors ("violent", "threatening", "menacing")
# are deliberately excluded — they are legitimate incident context, not place-ranking words.
# Word-boundary matching keeps legitimate substrings ("safely", "Safeway", "incident rate")
# and allowed count framing ("which area has the most crime") from false-triggering. The guard
# runs on BOTH the incoming user text and the model's final answer (see run_assistant_turn).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_colloquial_area_judgment_terms -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): guard colloquial place-character safety terms (H4)"
```

---

## Task 2: Spanish safety lexicon

**Files:**
- Modify: `app/assistant/agent.py` (append a Spanish safety-lexicon arm)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing test**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_spanish_safety_phrasings(tmp_path):
    # H4: Spanish safety-ranking requests must trip the deterministic guard (no model call),
    # including the accent-free forms users routinely type.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Qué zona es más segura?",
        "¿Es peligroso este barrio?",
        "¿Qué tan riesgoso es aquí?",
        "que lugar es mas seguro",  # accent-free
        "¿Es inseguro caminar por aquí?",
        "¿Esta zona está libre de crimen?",
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

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_safety_phrasings -v`
Expected: FAIL — Spanish safety words are not yet in the pattern, so the turn reaches the model.

- [ ] **Step 3: Write minimal implementation**

In `app/assistant/agent.py`, replace the English rank-arm's final line (the place-noun line that currently ends the pattern):

```python
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b",
```

with (drops the trailing comma from that line and appends the Spanish safety arm before the comma):

```python
    r"(?:place|block|area|neighbou?rhood|route|street|spot|option|location)s?\b"
    r"|\b(?:segur[oa]s?|insegur[oa]s?|peligros[oa]s?|peligro|riesgos[oa]s?|riesgos?"
    r"|arriesgad[oa]s?)\b"
    r"|\blibre\s+de\s+crimen\b",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_safety_phrasings -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): guard Spanish safety vocabulary (H4)"
```

---

## Task 3: Spanish rank/rate/score arm

**Files:**
- Modify: `app/assistant/agent.py` (append a Spanish rank-verb → place-noun arm)
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the failing test**

Append this function to `tests/test_assistant_agent.py`:

```python
def test_agent_redirects_spanish_bare_rank_requests(tmp_path):
    # H4: Spanish rank/rate/score verbs targeting a place noun (no safety word present) must
    # trip the guard, mirroring the English object-first rank arm. Includes accent-free forms.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "Clasifica estos barrios",
        "Califica estas zonas",
        "Puntúa las rutas",
        "clasifica estas areas",  # accent-free "áreas"
        "Clasifica los lugares por favor",
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

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_bare_rank_requests -v`
Expected: FAIL — a bare Spanish rank verb + place noun (no safety word) is not yet matched, so the turn reaches the model.

- [ ] **Step 3: Write minimal implementation**

In `app/assistant/agent.py`, replace the Spanish safety arm's last line (added in Task 2):

```python
    r"|\blibre\s+de\s+crimen\b",
```

with (appends the Spanish rank arm before the comma):

```python
    r"|\blibre\s+de\s+crimen\b"
    r"|\b(?:clasific|ranke|calific|puntu|puntú)\w*\s+"
    r"(?:(?:el|la|los|las|este|esta|estos|estas|ese|esa|esos|esas|mi|mis|tu|tus|su|sus"
    r"|un|una|unos|unas|todo|toda|todos|todas|cada)\s+)*"
    r"(?:lugar(?:es)?|(?:zona|barrio|[aá]rea|calle|ruta|sitio|cuadra)s?|ubicaci[oó]n(?:es)?)\b",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_redirects_spanish_bare_rank_requests -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_agent.py
git commit -m "feat(assistant): guard Spanish bare rank-by-place requests (H4)"
```

---

## Task 4: False-positive allow-list + output-side guard for new vocabulary

The regex is complete after Task 3. This task pins the false-positive boundary and the output-side guard for the new vocabulary. No production code change is expected; if a test fails, that reveals an over-match to fix in the pattern.

**Files:**
- Test: `tests/test_assistant_agent.py`

- [ ] **Step 1: Write the tests**

Append both functions to `tests/test_assistant_agent.py`:

```python
def test_agent_does_not_redirect_neutral_spanish_or_incident_terms(tmp_path):
    # H4 false-positive guard: neutral Spanish incident questions, English event/offense
    # descriptors excluded from the lexicon, and a bare Spanish place noun without a rank verb
    # must all reach the model — not the safety redirect.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    phrasings = [
        "¿Cuántos incidentes en esta zona?",  # neutral Spanish count question
        "How many violent crime incidents near here?",  # 'violent' deliberately excluded
        "Were there any threatening incidents nearby?",  # 'threatening' deliberately excluded
        "¿Cuál es la ruta más rápida?",  # fastest route — place noun w/o rank verb, not safety
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


def test_agent_redirects_spanish_safety_language_in_model_final_message(tmp_path):
    # H4 output-side guard: a model final answer containing Spanish safety vocabulary is
    # replaced with the standard redirect, not streamed. The input ("¿Dónde debería caminar?")
    # does NOT trip the input guard, so the model IS called (1 call) and the output guard fires.
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        ['{"type":"final","message":"La zona A es más segura que la zona B."}']
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="¿Dónde debería caminar?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    delta = events[1].data["delta"]
    assert "segura" not in delta  # the model's Spanish safety phrasing must not leak
    assert "reported incident" in delta  # replaced with the standard redirect
    assert len(client.calls) == 1  # the model WAS called (input guard didn't fire)
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py::test_agent_does_not_redirect_neutral_spanish_or_incident_terms tests/test_assistant_agent.py::test_agent_redirects_spanish_safety_language_in_model_final_message -v`
Expected: PASS. If `test_agent_does_not_redirect_neutral_spanish_or_incident_terms` FAILS, the pattern over-matches — narrow the offending arm in `app/assistant/agent.py` (e.g. an excluded word slipped in, or a place noun matches without its rank verb) and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/test_assistant_agent.py
git commit -m "test(assistant): pin H4 false-positive boundary + Spanish output guard"
```

---

## Task 5: Full verification gate + roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run the full guard test file**

Run: `.venv/bin/python -m pytest tests/test_assistant_agent.py -v`
Expected: PASS (all pre-existing guard tests — including `test_agent_does_not_redirect_allowed_count_or_neutral_phrasings` with "Is my data secure?" — plus the four new tests).

- [ ] **Step 2: Run the full verification gate**

Run: `make test-all`
Expected: pytest + `ruff check .` + frontend `npm test` + `npm run build` all pass. This change is backend-only, but the full gate runs per project convention (CLAUDE.md).

- [ ] **Step 3: Tick H4 in the roadmap**

In `docs/ROADMAP.md`, replace the H4 line:

```markdown
- [ ] **H4 · Assistant guard breadth** — close the residual synonym-lexicon / non-English gaps in the safety-refusal guard.
```

with:

```markdown
- [x] **H4 · Assistant guard breadth** — shipped: broadened the deterministic guard's English lexicon with colloquial place-character terms (`sketchy`/`shady`/`dodgy`/`seedy`/`scary`/`frightening`/`ghetto`) and added a Spanish mirror of both arms (safety lexicon + rank-verb→place-noun, accent-tolerant). Event/offense descriptors (`violent`/`threatening`/`menacing`) stay excluded as legitimate incident context. Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching) — deferred as a future increment. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-breadth*`.
```

- [ ] **Step 4: Update the maturity-snapshot invariant-risk line**

In `docs/ROADMAP.md`, replace the "Open — invariant risk" row:

```markdown
| **Open — invariant risk** | Safety-refusal guard hardened (object-first regex gap fixed #59; output-side guard + broadened ranking/determiner detection #63). Residual: synonym-lexicon + non-English breadth (lower-priority follow-up, Phase 4 H4) |
```

with:

```markdown
| **Open — invariant risk** | Safety-refusal guard hardened (object-first regex gap fixed #59; output-side guard + broadened ranking/determiner detection #63; English colloquial lexicon + Spanish arm added, H4). Residual: languages beyond English/Spanish (non-Latin scripts need script-aware matching) — deferred future increment |
```

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): tick H4 — assistant guard breadth (English colloquial + Spanish)"
```

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin h4-guard-breadth
gh pr create --base main --title "feat(assistant): safety-guard breadth — colloquial English + Spanish (Phase 4 H4)" --body "$(cat <<'EOF'
## Summary
Closes Phase 4 · H4. Extends the deterministic safety-refusal guard (`_SAFETY_SCORE_PATTERN`, `app/assistant/agent.py`) in place:
- **English colloquial lexicon:** `sketchy`, `shady`, `dodgy`, `seedy`, `scary`, `frightening`, `ghetto` — place-character judgments the invariant forbids.
- **Spanish arm:** mirrors both existing arms — a safety lexicon (`seguro`/`peligroso`/`riesgo`/…, accent-tolerant) and a rank-verb→place-noun arm (`clasifica estos barrios`).
- **Excluded** (still reach the model): `violent`/`threatening`/`menacing` (event/offense descriptors), `best`/`fastest route`, `secure`.

Architecture unchanged: one regex, checked on both input and the model's final answer, no LLM dependency. Backend-only.

## Tests
New cases in `tests/test_assistant_agent.py`: colloquial-term redirect, Spanish safety redirect, Spanish bare-rank redirect, an allow-list proving excluded/neutral phrasings still reach the model, and a Spanish output-side-guard test. `make test-all` green.

Spec/plan: `docs/superpowers/{specs,plans}/2026-07-01-assistant-guard-breadth*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Unicode regex:** Python's `re` is Unicode-aware by default, so `\w` and `\b` treat accented characters (`á`, `ó`, `ñ`) as word characters — accent-free variants are handled explicitly via character classes (`[aá]`, `ubicaci[oó]n`), and `re.IGNORECASE` covers capitalized forms.
- **Why the place noun alone is safe:** Spanish place nouns (`zona`, `ruta`, …) only match *inside* the rank arm, which requires a preceding rank verb. A bare "¿Cuál es la ruta más rápida?" therefore reaches the model — pinned by Task 4.
- **Tool summaries are not affected:** the output guard only runs on the free-form `final` message path, not on `build_tool_summary` output, so widening the lexicon cannot corrupt deterministic analysis summaries.
