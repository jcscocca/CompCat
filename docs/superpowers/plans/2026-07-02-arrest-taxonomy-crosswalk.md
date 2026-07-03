# Arrest↔crime Taxonomy Crosswalk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map an arrest's NIBRS offense description to the crime `offense_category` (PROPERTY/PERSON/SOCIETY) + `nibrs_group` at ingest, backfill existing arrest rows, and expose the category filter/comparison on the arrests layer.

**Architecture:** A new `app/crime/nibrs_crosswalk.py` holds the authoritative NIBRS-description → (category, group) table + `classify_nibrs()`. `arrest_from_mapping` calls it at ingest. Because ingest is insert-only, a one-time Alembic data migration backfills existing `seattle_spd_arrests` rows. The frontend flips the category filter on for arrests (they now carry categories). Existing category-filter/breakdown query logic needs no change.

**Tech Stack:** Python 3 / SQLAlchemy / Alembic (SQLite dev+CI, Postgres deploy); React + TS (Vitest).

**Design reference:** `docs/superpowers/specs/2026-07-02-arrest-taxonomy-crosswalk-design.md`

---

## File Structure

- **Create:** `app/crime/nibrs_crosswalk.py` — the mapping table + `classify_nibrs()` (Task 1).
- **Modify:** `app/crime/seattle_socrata.py` — `arrest_from_mapping` calls `classify_nibrs` (Task 2).
- **Create:** `app/alembic/versions/0011_arrest_category_backfill.py` — data migration (Task 3).
- **Modify:** `frontend/src/components/AnalyzeTab.tsx`, `frontend/src/components/CompareTab.tsx` — expose category filter on arrests (Task 4).
- **Modify (docs, Task 5):** `docs/architecture/data-model.md`, `docs/ROADMAP.md`.
- **Tests:** new `tests/test_nibrs_crosswalk.py` (Task 1), new `tests/test_arrest_category_backfill.py` (Task 3); update `tests/test_arrest_mapping.py` (Task 2), `frontend/.../AnalyzeTab.test.tsx` (Task 4).

Run Python: `.venv/bin/python -m pytest <file> -v`; migrations: `.venv/bin/python -m alembic upgrade head`; frontend: `cd frontend && npx vitest run <file>` + `npx tsc --noEmit`.

---

## Task 1: The NIBRS crosswalk module

**Files:**
- Create: `app/crime/nibrs_crosswalk.py`
- Test: `tests/test_nibrs_crosswalk.py`

- [ ] **Step 1: Write the failing tests.** Create `tests/test_nibrs_crosswalk.py`:

```python
import csv
from pathlib import Path

from app.crime.nibrs_crosswalk import classify_nibrs


def test_known_descriptions_map_to_category_and_group():
    assert classify_nibrs("All Other Larceny") == ("PROPERTY", "A")
    assert classify_nibrs("Drug/Narcotic Violations") == ("SOCIETY", "A")
    assert classify_nibrs("Simple Assault") == ("PERSON", "A")
    assert classify_nibrs("Burglary/Breaking & Entering") == ("PROPERTY", "A")
    assert classify_nibrs("Weapon Law Violations") == ("SOCIETY", "A")


def test_normalizes_case_and_whitespace():
    assert classify_nibrs("  simple ASSAULT  ") == ("PERSON", "A")


def test_unmapped_and_empty_return_none_none():
    assert classify_nibrs(None) == (None, None)
    assert classify_nibrs("") == (None, None)
    assert classify_nibrs("Some Unlisted Offense") == (None, None)


def test_every_seed_arrest_description_is_mapped():
    # Coverage: every distinct nibrs_description in the arrest seed must classify (non-None),
    # so real seed/ingest data is never silently uncategorized.
    seed = Path(__file__).resolve().parent.parent / "app" / "data" / "seed_arrests.csv"
    with seed.open(newline="", encoding="utf-8-sig") as fh:
        descriptions = {row["nibrs_description"] for row in csv.DictReader(fh)}
    for desc in descriptions:
        category, group = classify_nibrs(desc)
        assert category is not None, f"unmapped seed arrest offense: {desc!r}"
        assert group in {"A", "B"}, desc
```

- [ ] **Step 2: Run to verify red.**
Run: `.venv/bin/python -m pytest tests/test_nibrs_crosswalk.py -v`
Expected: FAIL — `app.crime.nibrs_crosswalk` doesn't exist.

- [ ] **Step 3: Create `app/crime/nibrs_crosswalk.py`** with the full Group A + Group B table. Keys are lowercase (the lookup casefolds); values are `(offense_category, nibrs_group)`:

```python
from __future__ import annotations

# NIBRS offense description -> (offense_category, nibrs_group), keyed on the lowercase
# (casefold) SPD nibrs_description text. Group A "crime against" assignments follow the FBI
# NIBRS classification (authoritative). Group B are arrest-only offenses with no formal NIBRS
# "crime against" category, so their assignments are BEST-EFFORT (see inline notes); the
# stakes are low because an unrecognized description simply stays uncategorized.
NIBRS_CROSSWALK: dict[str, tuple[str, str]] = {
    # --- Group A · Crime Against PERSON ---
    "murder & nonnegligent manslaughter": ("PERSON", "A"),
    "negligent manslaughter": ("PERSON", "A"),
    "justifiable homicide": ("PERSON", "A"),
    "kidnapping/abduction": ("PERSON", "A"),
    "rape": ("PERSON", "A"),
    "sodomy": ("PERSON", "A"),
    "sexual assault with an object": ("PERSON", "A"),
    "fondling": ("PERSON", "A"),
    "incest": ("PERSON", "A"),
    "statutory rape": ("PERSON", "A"),
    "aggravated assault": ("PERSON", "A"),
    "simple assault": ("PERSON", "A"),
    "intimidation": ("PERSON", "A"),
    "human trafficking, commercial sex acts": ("PERSON", "A"),
    "human trafficking, involuntary servitude": ("PERSON", "A"),
    # --- Group A · Crime Against PROPERTY ---
    "arson": ("PROPERTY", "A"),
    "bribery": ("PROPERTY", "A"),
    "burglary/breaking & entering": ("PROPERTY", "A"),
    "counterfeiting/forgery": ("PROPERTY", "A"),
    "destruction/damage/vandalism": ("PROPERTY", "A"),
    "destruction/damage/vandalism of property": ("PROPERTY", "A"),
    "embezzlement": ("PROPERTY", "A"),
    "extortion/blackmail": ("PROPERTY", "A"),
    "false pretenses/swindle/confidence game": ("PROPERTY", "A"),
    "credit card/automated teller machine fraud": ("PROPERTY", "A"),
    "impersonation": ("PROPERTY", "A"),
    "welfare fraud": ("PROPERTY", "A"),
    "wire fraud": ("PROPERTY", "A"),
    "identity theft": ("PROPERTY", "A"),
    "hacking/computer invasion": ("PROPERTY", "A"),
    "money laundering": ("PROPERTY", "A"),  # best-effort: financial → property
    "robbery": ("PROPERTY", "A"),
    "pocket-picking": ("PROPERTY", "A"),
    "purse-snatching": ("PROPERTY", "A"),
    "shoplifting": ("PROPERTY", "A"),
    "theft from building": ("PROPERTY", "A"),
    "theft from coin-operated machine or device": ("PROPERTY", "A"),
    "theft from motor vehicle": ("PROPERTY", "A"),
    "theft of motor vehicle parts or accessories": ("PROPERTY", "A"),
    "all other larceny": ("PROPERTY", "A"),
    "motor vehicle theft": ("PROPERTY", "A"),
    "stolen property offenses": ("PROPERTY", "A"),
    # --- Group A · Crime Against SOCIETY ---
    "drug/narcotic violations": ("SOCIETY", "A"),
    "drug equipment violations": ("SOCIETY", "A"),
    "betting/wagering": ("SOCIETY", "A"),
    "operating/promoting/assisting gambling": ("SOCIETY", "A"),
    "gambling equipment violations": ("SOCIETY", "A"),
    "sports tampering": ("SOCIETY", "A"),
    "pornography/obscene material": ("SOCIETY", "A"),
    "prostitution": ("SOCIETY", "A"),
    "assisting or promoting prostitution": ("SOCIETY", "A"),
    "purchasing prostitution": ("SOCIETY", "A"),
    "weapon law violations": ("SOCIETY", "A"),
    "animal cruelty": ("SOCIETY", "A"),
    # --- Group B (arrest-only) · best-effort ---
    "bad checks": ("PROPERTY", "B"),  # best-effort: financial instrument → property
    "curfew/loitering/vagrancy violations": ("SOCIETY", "B"),
    "disorderly conduct": ("SOCIETY", "B"),
    "driving under the influence": ("SOCIETY", "B"),
    "drunkenness": ("SOCIETY", "B"),
    "family offenses, nonviolent": ("PERSON", "B"),  # best-effort: against family members
    "liquor law violations": ("SOCIETY", "B"),
    "peeping tom": ("PERSON", "B"),  # best-effort: privacy of a person
    "trespass of real property": ("PROPERTY", "B"),  # best-effort: against real property
    "all other offenses": ("SOCIETY", "B"),
}


def classify_nibrs(description: str | None) -> tuple[str | None, str | None]:
    """Map a NIBRS offense description to (offense_category, nibrs_group). Returns (None, None)
    for a missing/blank/unrecognized description — the arrest still ingests, uncategorized."""
    if not description:
        return (None, None)
    return NIBRS_CROSSWALK.get(description.strip().casefold(), (None, None))
```

- [ ] **Step 4: Run to verify green.**
Run: `.venv/bin/python -m pytest tests/test_nibrs_crosswalk.py -v`
Expected: PASS (including the seed-coverage test — the seed's 8 distinct descriptions are all in the table).

- [ ] **Step 5: Ruff + commit.**
Run: `.venv/bin/ruff check app/crime/nibrs_crosswalk.py tests/test_nibrs_crosswalk.py`
```bash
git add app/crime/nibrs_crosswalk.py tests/test_nibrs_crosswalk.py
git commit -m "feat(crime): NIBRS offense -> category/group crosswalk table"
```

---

## Task 2: Wire the crosswalk into the arrest mapper

**Files:**
- Modify: `app/crime/seattle_socrata.py`
- Test: `tests/test_arrest_mapping.py`

- [ ] **Step 1: Update the failing assertions in `tests/test_arrest_mapping.py`.** The `_ROW` fixture has `nibrs_description: "All Other Larceny"`. In `test_arrest_row_maps_to_incident_fields`, replace:
```python
    assert incident.offense_category is None
    assert incident.nibrs_group is None
```
with:
```python
    assert incident.offense_category == "PROPERTY"
    assert incident.nibrs_group == "A"
```
(Leave `assert incident.offense_subcategory == "All Other Larceny"` unchanged — the raw description still populates the subcategory / "Charge" column.)

- [ ] **Step 2: Run to verify red.**
Run: `.venv/bin/python -m pytest tests/test_arrest_mapping.py -v`
Expected: FAIL — `arrest_from_mapping` still hardcodes `offense_category=None`/`nibrs_group=None`.

- [ ] **Step 3: Wire `classify_nibrs` into `arrest_from_mapping` (`app/crime/seattle_socrata.py`).** Add the import near the other `app.crime`/`app.schemas` imports at the top of the file:
```python
from app.crime.nibrs_crosswalk import classify_nibrs
```
In `arrest_from_mapping`, before the `return CrimeIncidentData(`, resolve the description once, and use it. Replace this block:
```python
        offense_category=None,
        # Best-effort taxonomy: NIBRS offense description goes in offense_subcategory. This
        # column therefore carries source-specific semantics (arrests vs SPD reports); safe
        # because reports-only default means arrests are never queried by category here, and
        # we never filter across sources. A unified crosswalk is a later increment.
        offense_subcategory=_first(row, "nibrs_description"),
        nibrs_group=None,
```
with:
```python
        # Map the NIBRS offense description to the crime taxonomy (offense_category +
        # nibrs_group) so arrests are comparable to reported crime by category. The raw
        # description still populates offense_subcategory (the "Charge" column); an
        # unrecognized description leaves category/group null (see nibrs_crosswalk).
        offense_category=_arrest_category,
        offense_subcategory=_arrest_nibrs,
        nibrs_group=_arrest_group,
```
and immediately after the `longitude = _float_or_none(...)` line at the top of `arrest_from_mapping` (before `return CrimeIncidentData(`), add:
```python
    _arrest_nibrs = _first(row, "nibrs_description")
    _arrest_category, _arrest_group = classify_nibrs(_arrest_nibrs)
```

- [ ] **Step 4: Run to verify green.**
Run: `.venv/bin/python -m pytest tests/test_arrest_mapping.py tests/test_nibrs_crosswalk.py -v`
Expected: PASS.

- [ ] **Step 5: Ruff + commit.**
Run: `.venv/bin/ruff check app/crime/seattle_socrata.py tests/test_arrest_mapping.py`
```bash
git add app/crime/seattle_socrata.py tests/test_arrest_mapping.py
git commit -m "feat(crime): classify arrest offense_category/nibrs_group at ingest via crosswalk"
```

---

## Task 3: Backfill migration for existing arrest rows

**Files:**
- Create: `app/alembic/versions/0011_arrest_category_backfill.py`
- Test: `tests/test_arrest_category_backfill.py`

- [ ] **Step 1: Write the failing migration test.** Create `tests/test_arrest_category_backfill.py`. It loads the digit-prefixed migration module by path via `importlib` and exercises its `_apply(connection)` helper against a seeded SQLite DB:

```python
import importlib.util
from datetime import UTC, datetime
from pathlib import Path

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident

_MIG_PATH = (
    Path(__file__).resolve().parent.parent
    / "app" / "alembic" / "versions" / "0011_arrest_category_backfill.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("mig_0011", _MIG_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed(session, *, id_, source, subcat, category=None, group=None):
    session.add(
        CrimeIncident(
            id=id_, external_incident_id=id_, source_dataset=source,
            offense_start_utc=datetime(2024, 1, 5, tzinfo=UTC),
            offense_category=category, offense_subcategory=subcat, nibrs_group=group,
            latitude=47.6, longitude=-122.3,
        )
    )


def test_backfill_categorizes_existing_arrests_only(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'bf.sqlite3'}")
    mig = _load_migration()
    session = get_sessionmaker()()
    try:
        _seed(session, id_="a1", source="seattle_spd_arrests", subcat="All Other Larceny")
        _seed(session, id_="a2", source="seattle_spd_arrests", subcat="Simple Assault")
        _seed(session, id_="a3", source="seattle_spd_arrests", subcat="Totally Unknown Offense")
        _seed(session, id_="c1", source="seattle_spd_crime", subcat="LARCENY-THEFT",
              category="PROPERTY", group="A")
        session.commit()

        mig._apply(session.connection())  # same transaction as the session
        session.expire_all()

        rows = {r.id: r for r in session.query(CrimeIncident).all()}
        assert (rows["a1"].offense_category, rows["a1"].nibrs_group) == ("PROPERTY", "A")
        assert (rows["a2"].offense_category, rows["a2"].nibrs_group) == ("PERSON", "A")
        # Unmapped arrest stays null.
        assert rows["a3"].offense_category is None
        # Crime row untouched (category preserved, not re-derived).
        assert rows["c1"].offense_category == "PROPERTY"

        # Idempotent: a second run changes nothing.
        mig._apply(session.connection())
        session.expire_all()
        assert session.get(CrimeIncident, "a1").offense_category == "PROPERTY"
    finally:
        session.close()
```

The migration exposes a private `_apply(bind)` helper (defined in Step 3) so the test runs the exact backfill SQL without the full alembic runner.

- [ ] **Step 2: Run to verify red.**
Run: `.venv/bin/python -m pytest tests/test_arrest_category_backfill.py -v`
Expected: FAIL — the migration module doesn't exist.

- [ ] **Step 3: Create `app/alembic/versions/0011_arrest_category_backfill.py`.** It embeds its own snapshot of the mapping (self-contained; does not import the app module). **Copy the exact entries from `app/crime/nibrs_crosswalk.py`'s `NIBRS_CROSSWALK` (all of them) into the `_CROSSWALK` dict below** — same keys/values:

```python
"""backfill arrest offense_category / nibrs_group from the NIBRS crosswalk

Revision ID: 0011_arrest_category_backfill
Revises: 0010_route_layer
Create Date: 2026-07-02 00:00:00.000000
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from alembic import op

revision = "0011_arrest_category_backfill"
down_revision = "0010_route_layer"
branch_labels = None
depends_on = None

# Self-contained snapshot of app/crime/nibrs_crosswalk.py::NIBRS_CROSSWALK at authoring time
# (migrations are immutable; do not import app code). Copy ALL entries verbatim.
_CROSSWALK: dict[str, tuple[str, str]] = {
    "murder & nonnegligent manslaughter": ("PERSON", "A"),
    # ... COPY EVERY ENTRY from NIBRS_CROSSWALK (Task 1) here, unchanged ...
    "all other offenses": ("SOCIETY", "B"),
}

_UPDATE = text(
    "UPDATE crime SET offense_category = :cat, nibrs_group = :grp "
    "WHERE source_dataset = 'seattle_spd_arrests' "
    "AND lower(offense_subcategory) = :desc "
    "AND offense_category IS NULL"
)


def _apply(bind: Connection) -> None:
    for desc, (cat, grp) in _CROSSWALK.items():
        bind.execute(_UPDATE, {"cat": cat, "grp": grp, "desc": desc})


def upgrade() -> None:
    _apply(op.get_bind())


def downgrade() -> None:
    op.get_bind().execute(
        text(
            "UPDATE crime SET offense_category = NULL, nibrs_group = NULL "
            "WHERE source_dataset = 'seattle_spd_arrests'"
        )
    )
```

Implementation notes for the engineer:
- **Copy the complete `_CROSSWALK`** from Task 1's `NIBRS_CROSSWALK` — every entry, identical keys and values. Do not abbreviate; the `# ... COPY EVERY ENTRY ...` line is a fill instruction, not final code.
- Keys are already lowercase; the SQL compares `lower(offense_subcategory)` so it matches regardless of stored casing. (`lower` exists on both SQLite and Postgres; NIBRS text is ASCII so `lower`/`casefold` agree.)
- `_apply(bind)` takes an already-open connection (the test passes `session.connection()`; `upgrade()` passes `op.get_bind()`), so the same helper is exercised by both the test and the real migration.

- [ ] **Step 4: Run the migration test + a full alembic chain check.**
Run: `.venv/bin/python -m pytest tests/test_arrest_category_backfill.py -v`
Expected: PASS.
Run: `.venv/bin/python -m alembic upgrade head`
Expected: succeeds (the new revision applies on top of `0010_route_layer`).

- [ ] **Step 5: Ruff + commit.**
Run: `.venv/bin/ruff check app/alembic/versions/0011_arrest_category_backfill.py tests/test_arrest_category_backfill.py`
```bash
git add app/alembic/versions/0011_arrest_category_backfill.py tests/test_arrest_category_backfill.py
git commit -m "feat(crime): backfill existing arrest rows with crosswalked category/group"
```

---

## Task 4: Expose the category filter/comparison on the arrests layer

**Files:**
- Modify: `frontend/src/components/AnalyzeTab.tsx`, `frontend/src/components/CompareTab.tsx`
- Test: `frontend/src/components/AnalyzeTab.test.tsx`

- [ ] **Step 1: Write/adjust the failing tests.** In `frontend/src/components/AnalyzeTab.test.tsx`, the arrests test currently asserts the category filter is HIDDEN on arrests. Update it and add the note-caveat check. Replace the existing `"shows the arrests enforcement note and hides the category filter on the arrests layer"` test body's category-filter assertion so it now expects the filter to SHOW, and pin the crosswalk caveat:
```ts
  it("shows the category filter and the enforcement note on the arrests layer", () => {
    render(<AnalyzeTab selected={[home]} analysis={{ ...analysis, layer: "arrests" }} availableRadii={[250, 500, 1000]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByText(/enforcement activity, not reported incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/incident categories/i)).toBeInTheDocument();          // now shown
    expect(screen.getByText(/best-effort/i)).toBeInTheDocument();                   // crosswalk caveat
  });
```
Keep the reported-layer test (`shows the category filter and no arrests note on the reported layer`) unchanged, and keep the calls-layer test (category filter hidden on calls) unchanged.

- [ ] **Step 2: Run to verify red.**
Run: `cd frontend && npx vitest run src/components/AnalyzeTab.test.tsx`
Expected: FAIL — the filter is still hidden on arrests and the caveat text isn't present.

- [ ] **Step 3: Flip `showCategory` + extend the arrests note in `AnalyzeTab.tsx`.**
Change (around line 446):
```ts
  const showCategory = analysis.layer === "reported"; // only reported carries offense categories
```
to:
```ts
  const showCategory = analysis.layer !== "calls"; // reported + arrests carry offense categories; 911 calls do not
```
Extend the arrests `mc-layer-note` (around lines 497-503) to add the best-effort caveat sentence. Replace the arrests note paragraph with:
```tsx
      ) : isArrestsLayer ? (
        <p className="mc-layer-note" role="note">
          Arrests are <strong>enforcement activity, not reported incidents</strong>. An arrest is
          logged where the arrest was made — which may differ from where an offense occurred — and
          most reported crimes never result in one. Categories are a <strong>best-effort</strong>{" "}
          NIBRS crosswalk from the arrest offense.
        </p>
      ) : null}
```

- [ ] **Step 4: Extend CompareTab's category gate to arrests (`CompareTab.tsx`).**
Change (line 95):
```ts
    analysis.layer === "reported" && analysis.offenseCategory !== "" && analysis.offenseCategory !== "PERSON";
```
to:
```ts
    analysis.layer !== "calls" && analysis.offenseCategory !== "" && analysis.offenseCategory !== "PERSON";
```

- [ ] **Step 5: Run tests + typecheck.**
Run: `cd frontend && npx vitest run src/components/AnalyzeTab.test.tsx src/components/CompareTab.test.tsx && npx tsc --noEmit`
Expected: PASS + clean. (If the calls-layer AnalyzeTab test asserted the category filter is hidden, it still passes — `showCategory` is false for calls. If a CompareTab test pinned the old `=== "reported"` gate for arrests, update it to the new behavior and note it.)

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/components/AnalyzeTab.tsx frontend/src/components/CompareTab.tsx frontend/src/components/AnalyzeTab.test.tsx
git commit -m "feat(analyze): expose category filter + comparison on the arrests layer"
```

---

## Task 5: Verification gate + docs + roadmap + PR

**Files:**
- Modify: `docs/architecture/data-model.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Full gate.**
Run: `make test-all`
Expected: pytest + ruff + frontend npm test + build all pass.
Run: `make migrate` (alembic upgrade head)
Expected: applies `0011_arrest_category_backfill` cleanly.

- [ ] **Step 2: Update `docs/architecture/data-model.md`.** In the Crime-entity / offense-category notes, update the line that says arrests carry null `offense_category`/`nibrs_group`: arrests now carry a **best-effort NIBRS-crosswalked** `offense_category` (PROPERTY/PERSON/SOCIETY) + `nibrs_group`, derived from the arrest offense description at ingest (`app/crime/nibrs_crosswalk.py`) and backfilled on existing rows (migration `0011`). `offense_subcategory` still holds the raw NIBRS description. Note that unrecognized descriptions remain uncategorized.

- [ ] **Step 3: Tick the roadmap.** In `docs/ROADMAP.md`, update the C4 line: mark the **arrest↔crime taxonomy crosswalk shipped** — arrests now carry a best-effort NIBRS-crosswalked `offense_category`/`nibrs_group`, with the category filter/comparison available on the arrests layer; the backfill migration categorizes existing rows. This closes the last queued C4 follow-up; **arrest demographics** (not ingested) remain the only deferred arrests item.

- [ ] **Step 4: Commit.**
```bash
git add docs/architecture/data-model.md docs/ROADMAP.md
git commit -m "docs(roadmap): arrest taxonomy crosswalk shipped (arrests carry mapped categories)"
```

- [ ] **Step 5: Push and open the PR.**
```bash
git push -u origin arrest-taxonomy-crosswalk
gh pr create --base main --title "feat(crime): arrest↔crime NIBRS taxonomy crosswalk" --body "$(cat <<'EOF'
## Summary
Arrests now carry an `offense_category` (PROPERTY/PERSON/SOCIETY) + `nibrs_group`, mapped from their NIBRS offense description, so the arrests layer supports category filtering and arrest-vs-crime category comparison.

- **Crosswalk** (`app/crime/nibrs_crosswalk.py`): full NIBRS Group A + B offense-description → (category, group) table, normalized (casefold) lookup; unrecognized → uncategorized. Group A follows the FBI "crime against" classification; Group B (arrest-only) is best-effort (commented).
- **Ingest**: `arrest_from_mapping` classifies at ingest (raw description still populates the "Charge" column).
- **Backfill** (migration `0011`): because ingest is insert-only, a one-time, idempotent, reversible, arrests-only data migration categorizes rows already stored.
- **UI**: the category filter/comparison now shows on the arrests layer (hidden only for 911 calls); the arrests note gains a "best-effort NIBRS crosswalk" caveat.

No change to crime/911 category derivation or the category filter/breakdown query logic — they just start seeing categorized arrests.

## Tests
`test_nibrs_crosswalk` (mappings, normalization, unmapped→None, seed coverage); `test_arrest_mapping` updated to assert a mapped category; `test_arrest_category_backfill` (arrests categorized, crime untouched, unmapped-null, idempotent); AnalyzeTab arrests category-filter + caveat. `make test-all` + `make migrate` green.

Spec/plan: `docs/superpowers/{specs,plans}/2026-07-02-arrest-taxonomy-crosswalk*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **The NIBRS table is the deliverable — copy it verbatim into the migration snapshot (Task 3).** The migration must contain the full mapping, not an abbreviation.
- **Group B assignments are best-effort** and commented as such; the seed-coverage test only pins the Group A offenses actually in the data. If a reviewer disputes a Group B call, it's a one-line change.
- **No cross-source category leakage:** the category filter already scopes by the active layer's `source_dataset`, so categorized arrests never mix into the reported (crime) counts — the layers stay disjoint (that's the #82 invariant).
- **Migration base:** `down_revision = "0010_route_layer"` (current head). If another migration has landed on `main` since, rebase the revision chain.
