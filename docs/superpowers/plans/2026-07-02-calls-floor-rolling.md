# Rolling 911-calls Data Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `CALLS_DATA_FLOOR` (which drifts past 24 months) with a rolling first-of-month 24-month window computed per ingest run.

**Architecture:** `CrimeSource.data_floor` becomes a resolver `Callable[[date | None], date]`. The 911 source resolves to a rolling `calls_data_floor(today)`; crime/arrests resolve to the fixed `CRIME_DATA_FLOOR`. The single consumer (`routes_admin_crime.py`) resolves the concrete floor with `date.today()`. Reference date is injectable for deterministic tests.

**Tech Stack:** Python 3 (`datetime.date`), pytest. Backend-only, no migration.

**Design reference:** `docs/superpowers/specs/2026-07-02-calls-floor-rolling-design.md`

---

## File Structure

- **Modify:** `app/crime/seattle_socrata.py` — replace the `CALLS_DATA_FLOOR` constant with `CALLS_WINDOW_MONTHS` + `calls_data_floor()` + `crime_data_floor()`.
- **Modify:** `app/crime/sources.py` — `CrimeSource.data_floor` resolver type; wire the three sources.
- **Modify:** `app/api/routes_admin_crime.py` — resolve `crime_source.data_floor(date.today())`.
- **Test:** new `tests/test_calls_data_floor.py`; update `tests/test_crime_sources.py` and `tests/test_seattle_socrata_floor.py` (both import the retired constant).

The code change is atomic (removing the constant breaks `sources.py`'s import until rewired), so Task 1 does it all in one TDD commit. Task 2 is the gate + roadmap + PR.

---

## Task 1: Rolling calls floor (helpers + resolver + consumer)

**Files:**
- Modify: `app/crime/seattle_socrata.py`, `app/crime/sources.py`, `app/api/routes_admin_crime.py`
- Test: `tests/test_calls_data_floor.py` (new), `tests/test_crime_sources.py`, `tests/test_seattle_socrata_floor.py`

- [ ] **Step 1: Write the new tests + update the two that reference the retired constant (red).**

(a) Create `tests/test_calls_data_floor.py`:
```python
from datetime import date

from app.crime.seattle_socrata import CRIME_DATA_FLOOR, calls_data_floor, crime_data_floor


def test_calls_floor_matches_the_retired_constant_at_mid_2026():
    # First-of-month, 24 months back from mid-2026 == the old fixed date(2024, 7, 1),
    # so the rolling change is seamless.
    assert calls_data_floor(date(2026, 7, 2)) == date(2024, 7, 1)


def test_calls_floor_rolls_forward_with_time():
    assert calls_data_floor(date(2027, 3, 15)) == date(2025, 3, 1)
    assert calls_data_floor(date(2028, 12, 31)) == date(2026, 12, 1)


def test_calls_floor_anchors_to_first_of_month():
    assert calls_data_floor(date(2026, 2, 28)).day == 1
    # Leap-safe: a Feb-29 reference does not raise and still anchors to the 1st.
    assert calls_data_floor(date(2028, 2, 29)) == date(2026, 2, 1)


def test_crime_floor_is_fixed_and_ignores_today():
    assert crime_data_floor(date(2030, 1, 1)) == CRIME_DATA_FLOOR
    assert crime_data_floor() == CRIME_DATA_FLOOR
```

(b) Update `tests/test_crime_sources.py`. Change the import block (lines 3-9) to drop `CALLS_DATA_FLOOR` and add `date`:
```python
from datetime import date

import pytest

from app.crime.seattle_socrata import (
    CRIME_DATA_FLOOR,
    arrest_from_mapping,
    call_from_mapping,
    crime_incident_from_mapping,
)
```
(Keep the existing `from app.crime.sources import (...)` block unchanged.) Then, in `test_registry_resolves_known_sources`, `data_floor` is now a resolver — change the three assertions to call it with a fixed reference date. Replace:
```python
    assert crime.data_floor == CRIME_DATA_FLOOR
```
with `assert crime.data_floor(date(2026, 7, 2)) == CRIME_DATA_FLOOR`; replace:
```python
    assert arrests.data_floor == CRIME_DATA_FLOOR
```
with `assert arrests.data_floor(date(2026, 7, 2)) == CRIME_DATA_FLOOR`; and replace:
```python
    # The call set is far larger, so it ingests from a later floor than reported crime.
    assert calls.data_floor == CALLS_DATA_FLOOR
    assert calls.data_floor > CRIME_DATA_FLOOR
```
with:
```python
    # The call set is far larger, so it ingests from a later (rolling) floor than crime.
    assert calls.data_floor(date(2026, 7, 2)) == date(2024, 7, 1)
    assert calls.data_floor(date(2026, 7, 2)) > CRIME_DATA_FLOOR
```

(c) Update `tests/test_seattle_socrata_floor.py`. Change the import (line 3) to drop `CALLS_DATA_FLOOR`:
```python
from app.crime.seattle_socrata import CRIME_DATA_FLOOR, floor_start_date
```
and rewrite `test_floor_accepts_a_custom_source_floor` to use a literal custom floor (this test is about `floor_start_date` clamping, not the rolling helper):
```python
def test_floor_accepts_a_custom_source_floor():
    # A source can pass its own later floor (e.g. the 911 window); earlier dates are lifted.
    custom_floor = date(2024, 7, 1)
    assert floor_start_date(date(2023, 1, 1), custom_floor) == custom_floor
    assert floor_start_date(None, custom_floor) == custom_floor
    assert floor_start_date(date(2025, 9, 1), custom_floor) == date(2025, 9, 1)
```

- [ ] **Step 2: Run to verify red.**
Run: `.venv/bin/python -m pytest tests/test_calls_data_floor.py tests/test_crime_sources.py tests/test_seattle_socrata_floor.py -v`
Expected: FAIL — `calls_data_floor`/`crime_data_floor` don't exist yet (import error in the new test), and `test_crime_sources` fails calling a `date` as a function (`data_floor` is still a plain date). `test_seattle_socrata_floor` should pass already (it no longer needs the constant).

- [ ] **Step 3: Implement the helpers in `app/crime/seattle_socrata.py`.** Replace the `CALLS_DATA_FLOOR` constant and its comment (currently lines ~17-22):
```python
CRIME_DATA_FLOOR = date(2018, 1, 1)
# The SPD Call Data set is ~24x the size of the reported-crime set (10.9M rows back to 2009),
# so it gets a much later floor — roughly a trailing 24 months from the project's current
# horizon. A fixed calendar floor (not a rolling window) mirrors CRIME_DATA_FLOOR and keeps
# ingest deterministic; lower it to date(2025, 7, 1) (12 months) if dev volume is too heavy.
CALLS_DATA_FLOOR = date(2024, 7, 1)
```
with:
```python
CRIME_DATA_FLOOR = date(2018, 1, 1)

# The SPD Call Data set is ~24x the size of the reported-crime set (10.9M rows back to 2009),
# so it gets a rolling, much-later floor instead of the full history. Lower CALLS_WINDOW_MONTHS
# (e.g. to 12) if dev volume is too heavy.
CALLS_WINDOW_MONTHS = 24


def calls_data_floor(today: date | None = None) -> date:
    """Rolling lower bound for 911-call ingest: the first of the month, CALLS_WINDOW_MONTHS
    back from ``today`` (defaults to date.today()). Computed per ingest run so the trailing
    window never drifts. Anchoring to the 1st is leap-safe; 24 months == exactly 2 years, so
    the year arithmetic is exact. ``today`` is injectable for deterministic tests."""
    ref = today or date.today()
    return date(ref.year - CALLS_WINDOW_MONTHS // 12, ref.month, 1)


def crime_data_floor(today: date | None = None) -> date:
    """Fixed lower bound for crime/arrest ingest (full history back to CRIME_DATA_FLOOR).
    Accepts ``today`` only to share the resolver signature with calls_data_floor; ignores it."""
    return CRIME_DATA_FLOOR
```
(`floor_start_date` below is unchanged — it still takes a concrete `date`.)

- [ ] **Step 4: Make the source floor a resolver in `app/crime/sources.py`.**

Change the import from `seattle_socrata` (lines 8-14) to drop `CALLS_DATA_FLOOR`/`CRIME_DATA_FLOOR` and add the two resolvers:
```python
from app.crime.seattle_socrata import (
    arrest_from_mapping,
    call_from_mapping,
    calls_data_floor,
    crime_data_floor,
    crime_incident_from_mapping,
)
```
Change the `CrimeSource.data_floor` field type (line 28):
```python
    data_floor: Callable[[date | None], date]  # resolves the earliest ingest date for a run
```
Wire the three sources in `CRIME_SOURCES`:
- `SOURCE_SPD_CRIME`: `data_floor=crime_data_floor`
- `SOURCE_SPD_ARRESTS`: `data_floor=crime_data_floor`
- `SOURCE_SPD_911`: `data_floor=calls_data_floor`

(`Callable` and `date` are already imported at the top of `sources.py`.)

- [ ] **Step 5: Resolve at the consumer in `app/api/routes_admin_crime.py`.** Change the one `data_floor` line (~line 56):
```python
        data_floor=crime_source.data_floor,
```
to:
```python
        data_floor=crime_source.data_floor(date.today()),
```
(`date` is already imported in this file.)

- [ ] **Step 6: Run to verify green.**
Run: `.venv/bin/python -m pytest tests/test_calls_data_floor.py tests/test_crime_sources.py tests/test_seattle_socrata_floor.py -v`
Expected: PASS (all). Then run the ingest-path suites to confirm the consumer resolves the floor without error:
Run: `.venv/bin/python -m pytest tests/test_crime_ingestion_service.py tests/test_crime_backfill.py -v`
Expected: PASS.

- [ ] **Step 7: Ruff + commit.**
Run: `.venv/bin/ruff check app/crime/seattle_socrata.py app/crime/sources.py app/api/routes_admin_crime.py tests/test_calls_data_floor.py tests/test_crime_sources.py tests/test_seattle_socrata_floor.py`
Expected: clean.
```bash
git add app/crime/seattle_socrata.py app/crime/sources.py app/api/routes_admin_crime.py tests/test_calls_data_floor.py tests/test_crime_sources.py tests/test_seattle_socrata_floor.py
git commit -m "feat(crime): rolling 24-month 911-calls data floor (no longer drifts)"
```

---

## Task 2: Verification gate + roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Full gate.**
Run: `make test-all`
Expected: `pytest` + `ruff check .` + frontend `npm test` + `npm run build` all pass. (Backend-only change; if any OTHER test imported the retired `CALLS_DATA_FLOOR` constant, fix it to the resolver/helper and note it — grep `CALLS_DATA_FLOOR` across the repo should return nothing after this task.)

- [ ] **Step 2: Tick the roadmap.** In `docs/ROADMAP.md`, find the C4 line's deferred-follow-ups note (it lists the `CALLS_DATA_FLOOR` fixed-date drift). Update it to record that the drift is **fixed** — the 911 floor is now a rolling first-of-month 24-month window computed per ingest run (`calls_data_floor`), so it no longer drifts past 24 months. Leave the **arrest↔crime taxonomy crosswalk** as the remaining deferred C4 follow-up.

- [ ] **Step 3: Commit.**
```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): 911-calls data floor drift fixed (rolling window)"
```

- [ ] **Step 4: Push and open the PR.**
```bash
git push -u origin calls-floor-rolling
gh pr create --base main --title "fix(crime): rolling 24-month 911-calls data floor" --body "$(cat <<'EOF'
## Summary
`CALLS_DATA_FLOOR` was a fixed `date(2024, 7, 1)` — set as ~24 months before the mid-2026 horizon, but it drifts as real time passes (the intended trailing-24-month 911 window silently grows). This replaces it with a **rolling first-of-month 24-month window computed per ingest run**:

- `calls_data_floor(today=None)` → first of the month, `CALLS_WINDOW_MONTHS` (24) back; `today` injectable for deterministic tests.
- `CrimeSource.data_floor` becomes a resolver callable — the 911 source rolls, crime/arrests stay fixed at `CRIME_DATA_FLOOR` (full history back to 2018).
- The single consumer (`routes_admin_crime.py`) resolves `data_floor(date.today())`.

Seamless: first-of-month 24 months before mid-2026 is `2024-07-01` — exactly the retired constant — so the value is unchanged today and then keeps pace. Backend-only, no migration; `CRIME_DATA_FLOOR` and the crime/arrest floors are untouched.

## Tests
`tests/test_calls_data_floor.py` pins the rolling behavior (matches the old date at mid-2026; rolls forward; first-of-month/leap-safe) and the fixed crime floor; `test_crime_sources`/`test_seattle_socrata_floor` updated to the resolver API. `make test-all` green.

Spec/plan: `docs/superpowers/{specs,plans}/2026-07-02-calls-floor-rolling*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **No migration, no frontend.** If you touch anything outside the six files above (plus `docs/ROADMAP.md` in Task 2), stop and reconsider.
- **`data_floor` is now a callable everywhere.** Any code or test that read `.data_floor` as a bare `date` must call it (`.data_floor(date.today())` in prod, `.data_floor(date(2026,7,2))` in tests). The grep in Task 2 Step 1 is the safety net.
- **Determinism:** never assert `calls_data_floor()` with no argument in a test (it reads the wall clock) — always pass a fixed reference date.
