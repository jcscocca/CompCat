# Repo Goes Public (Phase 7, Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Waypoint repo safely public under the name `waypoint` — full history audited, MIT-licensed, README rebuilt as the front door — per `docs/superpowers/specs/2026-07-09-public-capstone-design.md`.

**Architecture:** Audit first (nothing publishes until it passes), content changes via one PR on branch `repo-public-prep`, then two user-gated irreversible steps at the end (history rewrite *only if the audit demands it*, and the visibility flip). All audit artifacts (history dumps, pattern files, reports) live in the session scratchpad, **never** in the repo — the repo becomes public; the audit's working files must not.

**Tech Stack:** gitleaks (secrets scan), git-filter-repo (contingency only), `gh` CLI (rename, PR/issue sweep, visibility), sqlite3 (extracting personal patterns from the local dev DB).

**Two hard gates (user must explicitly approve):**
1. **Gate A (after Task 5):** audit report reviewed; any history rewrite approved before it runs.
2. **Gate B (Task 12):** the visibility flip to public.

**Facts already established (2026-07-10, don't re-derive):** real `.env`/`.env.deploy` were **never committed** (only `.example` files; verified via `git log --all -- .env .env.deploy` = empty). Seed CSVs (`app/data/seed_crime.csv`, `sample_crime.csv`) are **synthetic** (`SEED-000001`/`OFF-1` ids, fabricated block addresses). No image files anywhere in history. History is small: 403 commits, 1.07 MiB pack. Known triage item: `.env.deploy.example` line `MCA_LLM_BASE_URL=http://10.0.0.76:8080/v1` exposes a private LAN IP (RFC1918, unreachable from outside — genericize going forward in Task 8, no history rewrite warranted). GitHub repo is currently `jcscocca/crime-map-tool` (already renamed once from `crime-commute-safety-tool`; local remotes still use the old URL and redirect).

---

### Task 1: Install audit tooling

**Files:** none (host tooling only).

- [ ] **Step 1: Install gitleaks and git-filter-repo**

```bash
brew install gitleaks git-filter-repo
```

- [ ] **Step 2: Verify both run**

Run: `gitleaks version && git filter-repo --version`
Expected: two version strings (gitleaks 8.x). If brew is unavailable, `pipx install git-filter-repo` and download a gitleaks release binary.

---

### Task 2: Secrets sweep over full history

**Files:**
- Create (scratchpad, NOT repo): `$SCRATCH/audit/gitleaks-report.json`, `$SCRATCH/audit/full-history.txt`

Set `SCRATCH` to the session scratchpad directory first; every audit artifact goes under `$SCRATCH/audit/`.

- [ ] **Step 1: Create the audit dir and a full-history text dump**

The dump is the grep substrate for Tasks 2–3 (patch text + commit messages + author lines, all branches):

```bash
mkdir -p "$SCRATCH/audit"
cd "/Users/jscocca/Repos/Crime Commute Safety Tool"
git log --all -p --full-history > "$SCRATCH/audit/full-history.txt"
wc -l "$SCRATCH/audit/full-history.txt"
```

Expected: a dump on the order of a few hundred thousand lines (pack is ~1 MiB).

- [ ] **Step 2: Run gitleaks over the whole history**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool"
gitleaks git --redact --report-path "$SCRATCH/audit/gitleaks-report.json" . ; echo "exit=$?"
```

(Older gitleaks: `gitleaks detect -s . --redact --report-path ...`.)
Expected: exit=0 (no leaks) or exit=1 with findings to triage. Read the JSON; classify each finding true/false positive.

- [ ] **Step 3: Targeted greps gitleaks can miss (project-specific shapes)**

```bash
cd "$SCRATCH/audit"
grep -nEi "10\.0\.0\.[0-9]+|192\.168\.[0-9]+\.[0-9]+|SOCRATA_APP_TOKEN=[A-Za-z0-9]|ADMIN_INGEST_TOKEN=[A-Za-z0-9]|SESSION_SECRET=[a-f0-9]{16}|HASH_SALT=[a-f0-9]{16}|sk-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]|Bearer [A-Za-z0-9._-]{20}" full-history.txt > secrets-grep-hits.txt ; wc -l secrets-grep-hits.txt
```

Expected hits to be triaged: the known `10.0.0.76` LAN IP (accepted — see plan header), placeholder assignments from `.example` files (`replace-with-…`, `__run: openssl…`, empty `=`). Anything else → record in the Task 5 report as a redaction candidate.

- [ ] **Step 4: Record results**

Append a `## Secrets` section to `$SCRATCH/audit/report.md`: gitleaks exit status, each finding with verdict (false positive / accepted / REDACT).

---

### Task 3: Personal-data sweep (the user's real places)

**Files:**
- Create (scratchpad): `$SCRATCH/audit/personal-patterns.txt`, `$SCRATCH/audit/personal-hits.txt`

The sensitive strings (home/work addresses, place labels, coordinates) exist only in the **gitignored** local DB — extract them at runtime; never write them into any file inside the repo, including this plan.

- [ ] **Step 1: Extract the user's real place strings and coordinates from the local dev DB**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool"
sqlite3 dev-output/mobility.sqlite3 \
  "SELECT display_label FROM place_clusters UNION SELECT display_label FROM stop_visits UNION SELECT display_label FROM staging_location_observations;" \
  | grep -v '^$' | sort -u > "$SCRATCH/audit/personal-patterns.txt"
sqlite3 dev-output/mobility.sqlite3 \
  "SELECT printf('%.4f', latitude)||'|'||printf('%.4f', longitude) FROM place_clusters;" \
  | tr '|' '\n' | sort -u >> "$SCRATCH/audit/personal-patterns.txt"
sqlite3 dev-output/mobility.sqlite3 "PRAGMA table_info(geocode_cache);"
```

From the `geocode_cache` PRAGMA output, identify the query-text column and append its distinct values to `personal-patterns.txt` the same way. Then hand-prune the file: drop obviously non-personal labels (landmarks, test names like "Downtown transfer stop"), keep anything resembling a real home/work/school address or label.

- [ ] **Step 2: Ask the user for patterns the DB can't know**

Ask (in chat, answers go only into `personal-patterns.txt`): any past home/work street names, neighborhood-identifying strings, or other people's names/addresses ever typed into the app, docs, commit messages, or PR text.

- [ ] **Step 3: Sweep the history dump with those patterns**

```bash
grep -inFf "$SCRATCH/audit/personal-patterns.txt" "$SCRATCH/audit/full-history.txt" > "$SCRATCH/audit/personal-hits.txt" ; wc -l "$SCRATCH/audit/personal-hits.txt"
```

Expected: 0 lines. Any hit is a REDACT candidate (record file/commit via surrounding `commit`/`diff --git` lines in the dump).

- [ ] **Step 4: Generic address-shape sweep (catches addresses not in the DB)**

```bash
grep -nEi "[0-9]{2,5} [0-9A-Za-z .]{0,25}\b(St|Street|Ave|Avenue|Blvd|Way|Drive|Pl|Place|Rd|Road|Lane|Ct)\b" "$SCRATCH/audit/full-history.txt" | grep -vi "BLOCK" > "$SCRATCH/audit/address-shaped-hits.txt" ; wc -l "$SCRATCH/audit/address-shaped-hits.txt"
```

Triage note: SPD-style strings contain `BLOCK` (e.g. `500 BLOCK DOWNTOWN COMMERCIAL`) and are dataset content, hence the exclusion; landmark addresses in docs/tests are fine. A precise house-number address that maps to a real person → REDACT candidate.

- [ ] **Step 5: Record results**

Append `## Personal data` to `$SCRATCH/audit/report.md` with the same verdict format.

---

### Task 4: GitHub-surface sweep (PRs, issues, comments, branches)

Public visibility exposes more than git history: every PR/issue body and comment (much of it agent-written prose that may quote live-test data), plus all remote branches.

**Files:**
- Create (scratchpad): `$SCRATCH/audit/gh-prs.json`, `$SCRATCH/audit/gh-comments.json`, `$SCRATCH/audit/gh-hits.txt`

- [ ] **Step 1: Dump all PR/issue text**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool"
gh pr list --state all --limit 300 --json number,title,body > "$SCRATCH/audit/gh-prs.json"
gh issue list --state all --limit 300 --json number,title,body > "$SCRATCH/audit/gh-issues.json"
gh api "repos/{owner}/{repo}/issues/comments" --paginate > "$SCRATCH/audit/gh-comments.json"
gh api "repos/{owner}/{repo}/pulls/comments" --paginate > "$SCRATCH/audit/gh-review-comments.json"
```

- [ ] **Step 2: Sweep them with both pattern sets**

```bash
cd "$SCRATCH/audit"
cat gh-prs.json gh-issues.json gh-comments.json gh-review-comments.json > gh-all.json
grep -iFf personal-patterns.txt gh-all.json > gh-hits.txt
grep -Ei "10\.0\.0\.[0-9]+|SESSION_SECRET=[a-f0-9]{16}|ADMIN_INGEST_TOKEN=[A-Za-z0-9]" gh-all.json >> gh-hits.txt
wc -l gh-hits.txt
```

Expected: 0 lines. Hits are fixable **without** history rewrite: `gh pr edit <n> --body "<redacted>"` / `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -f body="<redacted>"` — note each in the report. (Old revisions of edited GitHub comments are visible only to the repo owner; deleting the comment removes it entirely if needed.)

- [ ] **Step 3: Prune stale remote branches (they go public too)**

```bash
git ls-remote --heads origin
```

For every branch other than `main` and `repo-public-prep`: confirm merged/abandoned (`git log origin/main..origin/<branch> --oneline`), then `git push origin --delete <branch>`. Record the list in the report.

- [ ] **Step 4: Record results**

Append `## GitHub surface` to `$SCRATCH/audit/report.md`.

---

### Task 5: Audit report + Gate A (user decision)

- [ ] **Step 1: Finalize `$SCRATCH/audit/report.md`**

Sections: Secrets / Personal data / GitHub surface; each finding with location + verdict (false positive / accepted-as-is / redact-via-gh-edit / REDACT-FROM-HISTORY); an explicit final line: `History rewrite required: YES/NO`.

- [ ] **Step 2: Present the report to the user and STOP**

Show the report inline (it contains sensitive strings — chat only, never commit it). **Do not proceed past this step without explicit user approval of the verdicts.**

- [ ] **Step 3 (CONTINGENCY — only if rewrite approved): rewrite history with git filter-repo**

Honesty note first, stated to the user before running: **a force-pushed rewrite does not scrub GitHub's copies** — old commits stay reachable via PR head refs and caches until GitHub support gc's them (or the repo is deleted and re-created). For truly sensitive findings the clean options are (a) rewrite + GitHub support ticket, or (b) the spec's fallback: push the rewritten history to a **new** `waypoint` repo and archive this one private. Decide with the user, then:

```bash
cd "$SCRATCH/audit"
# expressions file: one literal per line, format:  <secret-string>==>[REDACTED]
printf '%s==>[REDACTED]\n' "<each approved string>" > replacements.txt
git clone --mirror https://github.com/jcscocca/crime-map-tool.git rewrite.git
cd rewrite.git
git filter-repo --replace-text ../replacements.txt
git push --mirror https://github.com/jcscocca/crime-map-tool.git   # or the new repo URL for option (b)
```

Then re-clone/reset local checkouts and worktrees (`git fetch origin && git reset --hard origin/main` in each), and verify the strings are gone: re-run Task 2 Step 1 + Task 3 Step 3, expect 0 hits.

---

### Task 6: Rename the GitHub repo to `waypoint` (while still private)

- [ ] **Step 1: Confirm the name is free**

Run: `gh api repos/jcscocca/waypoint 2>&1 | head -3`
Expected: `404`/"Not Found" (name available). If it exists, stop and ask the user for an alternative.

- [ ] **Step 2: Rename**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool"
gh repo rename waypoint --yes
```

Expected: success message; old URLs (`crime-map-tool`, `crime-commute-safety-tool`) now redirect.

- [ ] **Step 3: Repoint the local remote and verify**

```bash
git remote set-url origin https://github.com/jcscocca/waypoint.git
git fetch origin && git remote -v
```

Expected: fetch succeeds with no "repository moved" warning.

---

### Task 7: MIT license + metadata alignment

**Files:**
- Create: `LICENSE`
- Modify: `pyproject.toml`, `frontend/package.json` (only if a conflicting/absent license field — check first)

- [ ] **Step 1: Write `LICENSE`** (standard MIT text, this exact header line):

```text
MIT License

Copyright (c) 2026 Jacob Scocca

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Align package metadata**

Run: `grep -n "license" pyproject.toml frontend/package.json`
If `pyproject.toml` lacks a license field, add `license = { text = "MIT" }` under `[project]`. If `frontend/package.json` has none or `"UNLICENSED"`, add `"license": "MIT",`. If either already declares something else, stop and ask.

- [ ] **Step 3: Commit**

```bash
git add LICENSE pyproject.toml frontend/package.json
git commit -m "chore: MIT license"
```

---

### Task 8: CONTRIBUTING note + LAN-IP genericization

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: `.env.deploy.example` (one line)

- [ ] **Step 1: Write `CONTRIBUTING.md`**

```markdown
# Contributing

Waypoint is a personal portfolio project, shared publicly so the code and the
methodology can be read — it is not seeking contributions and has no support
commitment.

- **Issues:** welcome for factual errors (a bug, a statistical mistake, a data
  misstatement). No feature requests, please.
- **Pull requests:** generally not accepted; open an issue first if you think
  something is genuinely broken.
- **Security:** if you find something sensitive exposed, email the address on
  the maintainer's GitHub profile rather than opening a public issue.

The product deliberately reports *reported incident context* only — issues
asking it to score or rank the safety of places will be closed by design (see
the product invariant in the README).
```

- [ ] **Step 2: Genericize the LAN IP in `.env.deploy.example`**

Replace the line `MCA_LLM_BASE_URL=http://10.0.0.76:8080/v1` with `MCA_LLM_BASE_URL=http://<llm-host-lan-ip>:8080/v1` (keep the surrounding comment).

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md .env.deploy.example
git commit -m "docs: CONTRIBUTING expectations note; genericize example LLM host"
```

---

### Task 9: Screenshots (light + night)

**Files:**
- Create: `docs/images/dashboard-light.png`, `docs/images/dashboard-night.png`

Run the app from the **main checkout** (it has the tile artifacts and the preview harness anchor; `git -C <main-checkout> pull` first so it's on current main). Use only landmark places — never real personal ones.

- [ ] **Step 1: Start the app with seeded data**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool"
git pull
make seed-crime            # realistic synthetic dataset (ends 2025-10)
make run                   # API on :8000, serves built dashboard if present
# hot-reload alternative: cd frontend && npm run dev  → :5173
```

- [ ] **Step 2: Stage a demo state**

In the UI (or via curl per README's end-to-end flow): add "Pike Place Market" (47.6097, -122.3422) and "Gas Works Park" (47.6456, -122.3344); run Analyze on one with a 2025 date window (seed data ends 2025-10 — a default 2026 window returns zero) so the map shows rings, beat highlight, and incident dots.

- [ ] **Step 3: Capture both themes at 1440×900**

Light theme → save as `docs/images/dashboard-light.png` (in the worktree, not the main checkout); toggle the theme control → `docs/images/dashboard-night.png`. Use the Claude Preview harness (`preview_resize` then reload — emulated resizes don't fire maplibre's resize — then `preview_screenshot`) or a manual browser capture.

- [ ] **Step 4: Verify and commit**

Check: each file exists, < 1 MB, shows only landmark places.

```bash
git add docs/images/
git commit -m "docs: dashboard screenshots (light + night)"
```

---

### Task 10: README front door

**Files:**
- Modify: `README.md` (top section, lines 1–9; licensing section; data-sources section)

The existing README body is accurate and invariant-forward — keep it. This task upgrades the top and closes two gaps (attribution, license section).

- [ ] **Step 1: Replace lines 1–9 (title + intro) with the front-door block**

```markdown
# Waypoint

[![CI](https://github.com/jcscocca/waypoint/actions/workflows/ci.yml/badge.svg)](https://github.com/jcscocca/waypoint/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Waypoint is a privacy-first web app for exploring **reported Seattle SPD incident context**
around the addresses you care about. Look up an address, pick a radius and date range, and
Waypoint shows how many reported incidents fall nearby, what kinds, and how candidate
addresses compare — with honest statistics (exposure-adjusted rates, confidence intervals,
overdispersion handling) and an optional AI analyst grounded in your dashboard.

> **The product invariant:** Waypoint describes *reported incident context*. It does **not**
> score safety, rank places as safe or unsafe, or claim anyone was present when an incident
> happened. The AI analyst refuses safety-scoring requests by design. This constraint shapes
> the whole product — see [docs/](docs/README.md) for how.

| Light | Night |
| --- | --- |
| ![Waypoint dashboard, light theme](docs/images/dashboard-light.png) | ![Waypoint dashboard, night theme](docs/images/dashboard-night.png) |

Built with FastAPI + SQLAlchemy/Alembic, React + TypeScript + Vite, MapLibre over a
self-hosted Seattle vector-tile extract, SQLite for dev / Postgres for deploy. The deployed
app makes **zero third-party requests** — tiles, fonts, and geocoding are all self-hosted or
proxied.
```

- [ ] **Step 2: Add beat-boundary attribution to the "Data sources and caveats" section**

Append to that section (exact text may be adjusted by Task 11's terms check):

```markdown
Police beat boundaries come from the City of Seattle's open GIS data (Seattle Police
Department beats, 2018-present vintage). The bundled seed/sample incident CSVs are
synthetic — generated to resemble the SPD schema for offline development — not
redistributed SPD records.
```

- [ ] **Step 3: Replace the "References and licensing" section**

```markdown
## License

MIT — see [LICENSE](LICENSE). This implementation is original; related projects (Google
Timeline parsing tools, Reitti, GeoPulse, Dawarich, and Seattle crime-data pipelines) were
used as architecture references only.
```

- [ ] **Step 4: Verify rendering and links**

Run: `grep -nE "\]\((docs/|LICENSE|CONTRIBUTING)" README.md` and confirm each referenced path exists (`ls docs/images/ LICENSE CONTRIBUTING.md`). Badge URLs 404 until the repo is public — expected; they use the post-rename `waypoint` name.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README as the public front door (badges, invariant callout, screenshots)"
```

---

### Task 11: Seattle open-data terms check

**Files:**
- Modify: `README.md` (only if the terms require different attribution wording)

- [ ] **Step 1: Fetch the City of Seattle open-data terms**

WebFetch `https://data.seattle.gov/stories/s/Data-Policy` (and/or `http://www.seattle.gov/tech/initiatives/open-data/open-data-policy`). Question to answer: do the terms permit redistribution/derived use of (a) the beats GeoJSON and (b) schema-shaped synthetic data, and what attribution do they ask for?

- [ ] **Step 2: Reconcile**

Seattle's open-data program publishes under permissive terms (typically public-domain-equivalent); if the fetched terms require specific attribution language, update the Task 10 Step 2 paragraph to match and amend:

```bash
git add README.md && git commit --amend --no-edit   # only if not yet pushed; otherwise a new commit
```

Record the verdict + URL in a one-line note appended to the roadmap tick in Task 12 (e.g. "terms verified 2026-07-XX").

---

### Task 12: Roadmap tick, PR, Gate B (publish), post-public verification

- [ ] **Step 1: Tick slice 1 in the roadmap**

In `docs/ROADMAP.md`, Phase 7 section: change `- [ ] **Slice 1 — Repo goes public:**` to `- [x]`, and append `Shipped: audit (report private), LICENSE, CONTRIBUTING, README front door, rename → waypoint, published <date>.` to that bullet.

- [ ] **Step 2: Run the verification gate and open the PR**

```bash
cd "/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/repo-public-prep"
make test-all
git push -u origin repo-public-prep
gh pr create --title "docs: repo-public prep — LICENSE, CONTRIBUTING, README front door (Phase 7 slice 1)" --body "## What

Phase 7 slice 1 content prep (spec: docs/superpowers/specs/2026-07-09-public-capstone-design.md, plan: docs/superpowers/plans/2026-07-10-repo-public.md):

- MIT LICENSE + license metadata alignment (pyproject, frontend package.json)
- CONTRIBUTING.md expectations note (portfolio project, factual-error issues only)
- README rebuilt as the public front door: CI/license badges, invariant callout, light+night screenshots, beat-boundary attribution, License section
- .env.deploy.example LLM host genericized
- Roadmap slice-1 tick

History audit ran separately (report kept private, outside the repo). The visibility flip happens after this merges — Gate B.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: `make test-all` green (docs + metadata changes only; the pyproject edit is why we run it). User reviews and squash-merges.

- [ ] **Step 3: GATE B — user flips visibility (or explicitly approves the command)**

Preconditions checklist to show the user: audit report approved (Gate A) ✓ · redactions done ✓ · stale branches deleted ✓ · rename done ✓ · content PR merged ✓. Then:

```bash
gh repo edit jcscocca/waypoint --visibility public --accept-visibility-change-consequences
```

- [ ] **Step 4: Post-public verification**

```bash
gh api repos/jcscocca/waypoint --jq '.visibility, .license.spdx_id'   # expect: public, MIT
gh run list --limit 3    # CI runs on the public repo
curl -sI https://github.com/jcscocca/waypoint | head -1              # 200
curl -s https://github.com/jcscocca/crime-map-tool -o /dev/null -w "%{http_code}\n"  # 301 redirect
```

Also verify the README badge renders (fetch the badge SVG URL, expect 200) and spot-check the public repo page in a browser: README, screenshots, LICENSE detected by GitHub.

- [ ] **Step 5: Update project memory**

Update the Phase 7 memory file: slice 1 shipped (date, PR number, audit verdict summary — no sensitive strings), repo now public at `jcscocca/waypoint`.

---

## Self-review notes (2026-07-10)

- **Spec coverage:** history audit (Tasks 2–5) ✓ · filter-repo contingency (Task 5 Step 3, with the honest GitHub-refs caveat and new-repo fallback) ✓ · MIT (7) ✓ · rename (6) ✓ · README front door (9–10) ✓ · Socrata terms (11) ✓ · public CI + badge (10, 12) ✓ · CONTRIBUTING (8) ✓.
- **Ordering rationale:** rename (6) after Gate A so a rewrite-into-new-repo decision, if taken, claims the `waypoint` name directly; content tasks (7–10) are safe on the private repo either way.
- **Deliberate deviations from pure TDD:** this slice is ops/docs; verification commands replace tests. The one code-adjacent edit (pyproject/package.json license fields) is covered by `make test-all` in Task 12.
