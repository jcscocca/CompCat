# Capstone Write-up (Phase 7 Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two long-form capstone essays (methodology + product ethics) under `docs/writeups/`, wire them into the README / docs index / roadmap, and close Phase 7.

**Architecture:** Docs-only slice. Two first-person essays (~2,000–3,000 words each) with a decision-trail spine and question headings, per `docs/superpowers/specs/2026-07-26-capstone-writeup-design.md`. Every factual claim is pulled from the cited source docs or code — never from memory. No new figures, scripts, or code.

**Tech Stack:** Markdown only. Verification is `make test-all` (must stay green — no code changes), a link-existence check, and a manual invariant read.

**Branch/worktree:** `phase7-writeup` at `.worktrees/phase7-writeup` (cut from `origin/main`).

---

### Task 1: Draft `docs/writeups/statistical-methods.md`

**Files:**
- Create: `docs/writeups/statistical-methods.md`
- Read first (sources of truth): `docs/analysis/exposure-model.md`, `docs/analysis/overdispersion-and-rate-intervals.md`, `docs/analysis/pairwise-comparison-engine.md`, `docs/analysis/statistical-methods-audit-2026-07.md`, `docs/analysis/trend-indexing-method.md` (skim), `app/analysis/rate_tests.py` (skim for names only)

- [ ] **Step 1: Read the five source docs above in full** (trend doc may be skimmed). Do not draft from memory; pull every number from these docs.

- [ ] **Step 2: Draft the essay** to `docs/writeups/statistical-methods.md`. First person, ~2,000–3,000 words, question headings. H1 title: pick one evocative title (candidates: "Counting Crimes Without Keeping Score", "Honest Numbers About Reported Crime", or your better alternative — reviewed with the essay). Open with a 2–3 sentence framing: CompCat compares reported-incident context around addresses, and every statistical choice below exists to keep those comparisons honest. Then the six sections:

  1. **"Why can't you just count incidents?"** — Raw counts conflate incidence with area and time. The exposure denominator is `π·r²·days` (buffer area × window length); the rate is *reported incidents per exposure*, deliberately not a per-capita risk (no population/ambient denominator — see `exposure-model.md` §2 for why: no defensible small-area denominator exists at buffer scale, and a wrong one manufactures false precision). Mention MAUP/radius sensitivity honestly (§3): the user picks the radius, and results are radius-dependent by design. Link `../analysis/exposure-model.md`.
  2. **"Compared to what?"** — A count means nothing without a baseline. Rest-of-beat (buffer carved out of its police beat) is the honest local comparison; the ladder is MCPP / beat / sector / city (`exposure-model.md` §4: carved-out for MCPP/beat, whole-area with bounded self-inclusion for sector/city). Beat assignment is point-in-polygon against real SPD beat polygons.
  3. **"Is Poisson enough?"** — The centerpiece. Real SPD data (712,999 incidents, Socrata `tazs-3rd5`, 2018 floor) is strongly overdispersed: Pearson φ̂ ≈ 7 at beat scale. But the *form* matters: the log–log variance-on-mean slope is ≈ 1.1–1.3 at every scale measured — the quasi-Poisson signature (slope 1), not NB2's (slope → 2). NB2 actively misfits: under-predicts variance at low means, over-predicts at high (cite the bin table). So: quasi-Poisson with an empirically estimated φ, floored at 1.0. Include the honest coda from §5.1: φ estimated from ~12 monthly bins is noisy, so inference uses Student-t on ν = bins − 1 (Wedderburn convention), which lifted measured coverage (e.g. φ=7, μ=10: 0.827 → 0.891) — and a pinned residual remains at φ=7 stress cells, outside the regime the per-address surface actually lives in (reporting-area φ̂ ≈ 1.5). Link `../analysis/overdispersion-and-rate-intervals.md`.
  4. **"How do you avoid crowning a winner by chance?"** — Comparing k candidates invites the winner's curse. Benjamini–Hochberg across the pairwise family; the verdict requires the low-rate candidate to beat *every* alternative significantly plus an effect-size floor plus the data floors — the selective-inference review concluded selection alone cannot crown a winner (conservative by design). Supplementary exact conditional-Poisson p-value reported for transparency. Link `../analysis/pairwise-comparison-engine.md`.
  5. **"When should the answer be 'not enough data'?"** — `MIN_PLACE_COUNT` / `MIN_COMBINED_COUNT` floors, `model_warning` on single-period series, interval suppression rules, and the audit's stance that refusing to answer beats a fabricated answer. Link `../analysis/statistical-methods-audit-2026-07.md` (the scorecard: where practice meets/exceeds the literature and the accepted divergences).
  6. **Close: "What the numbers still can't say."** — Reported ≠ occurred (the reporting confound), enforcement ≠ incidence, and no number here is a safety score — hand off to `product-ethics.md` with a link.

  Every section states the decision, the evidence that forced it, and links its analysis doc. Quote specific numbers only from the source docs read in Step 1.

- [ ] **Step 3: Verify factual claims against sources.** Re-open each cited doc and check every number/claim that appears in the draft (φ values, slope range, incident total, coverage before/after, constant names). Fix any mismatch now.

- [ ] **Step 4: Link check.** Run from the worktree root:

```bash
grep -oE '\]\(([^)#]+)\)' docs/writeups/statistical-methods.md | sed -E 's/\]\((.*)\)/\1/' | grep -v '^http' | sort -u | while read -r p; do [ -f "docs/writeups/$p" ] || echo "BROKEN: $p"; done
```

Expected: no output. Fix any `BROKEN:` lines.

- [ ] **Step 5: Invariant read.** List every occurrence of the refused lexicon for manual review:

```bash
grep -inE 'safe|unsafe|danger|risk|sketchy|shady' docs/writeups/statistical-methods.md
```

Every hit must be a *mention* (a term the product refuses, in quotes/italics or negation) — never a characterization of a real place, and no example may rank real neighborhoods. Fix any violation.

- [ ] **Step 6: Commit**

```bash
git add docs/writeups/statistical-methods.md
git commit -m "docs(writeups): capstone methodology essay"
```

---

### Task 2: Draft `docs/writeups/product-ethics.md`

**Files:**
- Create: `docs/writeups/product-ethics.md`
- Read first (sources of truth): `README.md` (invariant callout + privacy posture), `docs/architecture/assistant.md`, `app/assistant/agent.py` (the guard: `_UNAMBIGUOUS_SAFETY_PATTERN`, `_AMBIGUOUS_TERM_PATTERN`, `_PLACE_CONTEXT_PATTERN`, `_contains_safety_ranking`), `docs/ROADMAP.md` (H4 entry, C4 arrests entry, routes-removal note), `docs/superpowers/specs/2026-07-03-routes-removal-design.md`, `docs/superpowers/specs/2026-07-02-arrests-third-layer-design.md`, `docs/superpowers/specs/2026-07-12-assistant-token-streaming-design.md` (holdback guard section)

- [ ] **Step 1: Read the sources above.** For the guard, read the actual patterns in `app/assistant/agent.py` — describe what is implemented today, not what any historical spec proposed.

- [ ] **Step 2: Draft the essay** to `docs/writeups/product-ethics.md`. First person, ~2,000–3,000 words, question headings. H1 title candidates: "The Feature I Won't Build", "What CompCat Refuses to Say" — or better. Open by naming the invariant verbatim-adjacent: CompCat describes reported-incident context and will not score safety, rank places as safe/unsafe/dangerous, or claim anyone was present. Then:

  1. **"Why refuse the thing users most want?"** — Users arrive wanting "is this neighborhood safe?". Why the answer is unknowable from this data (reported ≠ occurred; reporting rates vary by place and offense; a score would launder that bias into false authority) and why the refusal is the product's identity, not a legal disclaimer. The invariant shapes the lexicon everywhere: "lower reported-incident rate" is permitted; "safer" is not.
  2. **"How do you make an LLM refuse reliably?"** — Prompting isn't enough; the guard is deterministic code, not model behavior. Describe the three cooperating regex patterns (unambiguous safety asks; ambiguous colloquial terms that trip only alongside place context; the place-context detector), English + Spanish arms, input side across recent turns plus an output-side check, and the streamed-narration holdback that keeps the invariant absolute mid-stream. Name the accepted trade-off: fail-safe over-refusal (e.g. Spanish epistemic "estoy seguro de X" near a place word) is chosen over under-refusal.
  3. **"Why delete a shipped feature?"** — Routes shipped, worked, and was removed in 2026-07: comparing commute corridors drifted toward the product implicitly ranking areas, and the address-first pivot kept the surface the invariant can defend. Deleting working code because the framing was wrong is the strongest evidence the invariant is real.
  4. **"Why split arrests from crime reports?"** — Arrests were first unioned into "reported incidents", then de-merged into a third, clearly-labeled layer: on redacted public data an arrest cannot be linked to its crime report (double-count risk), and enforcement activity ≠ incidence — conflating them silently biases exactly the comparisons the product exists to keep honest. Calls are likewise framed as requests for service, not confirmed incidents.
  5. **"What does privacy-first mean concretely?"** — The deployed app makes zero third-party requests: self-hosted vector tiles (no tile server sees viewports), self-hosted fonts, geocoding proxied server-side with caching/rate-limiting. Exports and share links carry generalized (~110 m) coordinates; sensitive place classes are excluded from exports by default; personal uploads ship disabled, raw points are deleted after clustering, and there is a delete-everything control.
  6. **Close: "What refusing buys."** — Trust: because the product never scores, everything it *does* say can be taken at face value. Link back to `statistical-methods.md` for how the numbers stay honest.

- [ ] **Step 3: Verify factual claims against sources.** Re-check: guard pattern names against `app/assistant/agent.py`; routes-removal and arrests rationale against their specs; privacy claims against `README.md` (e.g. uploads default, generalized coordinates, zero-third-party claim). Fix mismatches now.

- [ ] **Step 4: Link check.** Same command as Task 1 Step 4 with `docs/writeups/product-ethics.md`. Expected: no output.

- [ ] **Step 5: Invariant read.** Same command as Task 1 Step 5 with `docs/writeups/product-ethics.md`. This essay names the refused words by necessity — every occurrence must still be mention-not-use; no real place is ever characterized.

- [ ] **Step 6: Commit**

```bash
git add docs/writeups/product-ethics.md
git commit -m "docs(writeups): capstone product-ethics essay"
```

---

### Task 3: Integration — README, docs index, roadmap

**Files:**
- Modify: `README.md` (after the invariant blockquote, currently ending line 17)
- Modify: `docs/README.md` (canonical-docs table)
- Modify: `docs/ROADMAP.md` (Phase 7 Slice 3 checkbox + "Where it stands" paragraph)

- [ ] **Step 1: README.** Insert directly after the invariant blockquote (`> ... see [docs/](docs/README.md) for how.`), before the screenshot table:

```markdown

Two long-form write-ups tell the full story: [the statistics](docs/writeups/statistical-methods.md)
(exposure, overdispersion, quasi-Poisson vs. negative binomial, multiple comparisons) and
[the product ethics](docs/writeups/product-ethics.md) (why CompCat refuses to score safety,
and what that refusal cost).
```

- [ ] **Step 2: docs/README.md.** Add one row to the canonical-docs table, after the Roadmap row:

```markdown
| [Write-ups](writeups/statistical-methods.md) | The two long-form capstone essays: [statistical methods](writeups/statistical-methods.md) and [product ethics](writeups/product-ethics.md) — the narrative layer over `analysis/`. |
```

- [ ] **Step 3: ROADMAP.** Two edits:
  - Check the Slice 3 box and append the shipped note, keeping the original item text:

```markdown
- [x] **Slice 3 — Write-up:** the methodology story (QP-vs-NB settled empirically,
  baselines, BH) and the product-ethics story (the invariant, routes removal, arrests
  de-merge, privacy posture) as long-form pieces linked from the README. **Shipped
  2026-07-26:** two first-person essays under `docs/writeups/` (statistical methods,
  product ethics). Spec: `docs/superpowers/specs/2026-07-26-capstone-writeup-design.md`.
  **This closes Phase 7.**
```
  - In the "Where it stands" paragraph (currently "Remaining work is focused rather than foundational: the capstone write-up, first-device acceptance, the Postgres soak run, ..."), remove "the capstone write-up, " so the remaining-work list reflects reality.

- [ ] **Step 4: Link check both modified indexes.** From worktree root:

```bash
for f in docs/writeups/statistical-methods.md docs/writeups/product-ethics.md; do [ -f "$f" ] || echo "BROKEN: $f"; done
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/README.md docs/ROADMAP.md
git commit -m "docs: link capstone write-ups from README + docs index; close Phase 7 in roadmap"
```

---

### Task 4: Verification gate

**Files:** none modified (fixes only if verification fails)

- [ ] **Step 1: One-time worktree setup** (skip pieces that already exist):

```bash
make install
make frontend-install
```

- [ ] **Step 2: Run the full gate:**

```bash
make test-all
```

Expected: pytest green, ruff clean, frontend tests green, frontend build succeeds — identical to `origin/main` since no code changed. If anything fails, it is pre-existing or environmental; investigate before touching anything.

- [ ] **Step 3: Final invariant + link sweep over the whole diff:**

```bash
git diff origin/main --stat
git diff origin/main -- docs/writeups/ README.md docs/README.md docs/ROADMAP.md | grep -iE '\b(safest|safer city|is safe|unsafe|dangerous)\b' || echo CLEAN
```

Review any hits as in Task 1 Step 5 (mention-not-use). Expected final line: `CLEAN` or only mention-not-use hits.

- [ ] **Step 4: No commit needed** unless Steps 2–3 forced fixes; if so, commit them with `docs(writeups): review fixes`.

---

## Review notes for the essay drafts

- Both essays are portfolio prose: first person, concrete, no marketing tone, no rhetorical padding. Prefer "I chose X because Y showed Z" over abstractions.
- Do not duplicate `docs/analysis/` content — summarize the decision and evidence, link the reference for derivations.
- 2,000–3,000 words each. If a draft runs long, cut inline detail and lean on links.
- The essays must render correctly on GitHub (plain Markdown, tables ok, no HTML).
