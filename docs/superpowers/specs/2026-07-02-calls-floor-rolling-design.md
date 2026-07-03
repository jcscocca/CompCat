# Rolling 911-calls data floor (C4 follow-up) — design

**Date:** 2026-07-02 · **Roadmap item:** Phase 4 · C4 follow-up (`CALLS_DATA_FLOOR` drift) ·
**Status:** approved design, pre-implementation.

## Problem

`CALLS_DATA_FLOOR = date(2024, 7, 1)` in `app/crime/seattle_socrata.py` is the earliest date
the SPD 911 Call Data source is ingested from. The 911 dataset is ~24× the size of the crime
set, so it was deliberately given a much later, **fixed** floor — chosen as roughly a trailing
24 months from the project's mid-2026 horizon (the comment states the fixed floor was picked
for ingest determinism). As real time advances, that fixed calendar date falls further than 24
months in the past, so the intended trailing-24-month window silently grows — by mid-2027 it's
~36 months, and so on. The window drifts.

## Decision

Make the calls floor a **rolling, first-of-month, 24-months-back** window computed **per ingest
run** (approved during brainstorming), replacing the fixed constant. The reference date is
injectable so the computation stays deterministic under test. `CRIME_DATA_FLOOR` stays fixed —
crime is intentionally ingested back to 2018.

Continuity note: first-of-month, 24 months before mid-2026 is `date(2024, 7, 1)` — exactly the
current constant — so this is a seamless change that then keeps pace with real time.

## Scope

**In scope (backend only):**
- Replace the `CALLS_DATA_FLOOR` constant with a `calls_data_floor(today=None)` helper.
- Make `CrimeSource.data_floor` a resolver callable so the calls source can roll while crime/
  arrests stay fixed.
- Resolve the concrete floor at the single consumer (`routes_admin_crime.py`).
- Tests for the rolling helper + the resolver.

**Out of scope:**
- `CRIME_DATA_FLOOR` / the crime and arrest floors (fixed by design; unchanged).
- Any change to backfill/watermark logic, the Socrata client, `floor_start_date`, or ingest
  behavior beyond the lower-bound window tracking real time.
- No database migration; no frontend.

## Approach

### 1 · Rolling helper (`app/crime/seattle_socrata.py`)

Replace the `CALLS_DATA_FLOOR = date(2024, 7, 1)` constant (and its comment) with:

```python
CALLS_WINDOW_MONTHS = 24


def calls_data_floor(today: date | None = None) -> date:
    """Rolling lower bound for 911-call ingest: the first of the month, CALLS_WINDOW_MONTHS
    back from `today` (defaults to date.today()). Computed per ingest run so the trailing
    window never drifts. Anchoring to the 1st is leap-safe; 24 months = exactly 2 years, so
    the year arithmetic is exact. `today` is injectable for deterministic tests."""
    ref = today or date.today()
    return date(ref.year - CALLS_WINDOW_MONTHS // 12, ref.month, 1)
```

Add a fixed-floor helper with the same signature so all sources resolve uniformly:

```python
def crime_data_floor(today: date | None = None) -> date:
    """Fixed lower bound for crime/arrest ingest (the full history back to CRIME_DATA_FLOOR).
    Takes `today` only to share the resolver signature with calls_data_floor; ignores it."""
    return CRIME_DATA_FLOOR
```

`CRIME_DATA_FLOOR = date(2018, 1, 1)` and `floor_start_date(start_date, floor)` are unchanged —
`floor_start_date` still receives a concrete `date`.

### 2 · Resolver-typed source floor (`app/crime/sources.py`)

Change `CrimeSource.data_floor` from `date` to a resolver:

```python
@dataclass(frozen=True)
class CrimeSource:
    key: str
    dataset_attr: str
    mapper: Callable[[dict[str, Any]], CrimeIncidentData]
    date_field: str
    data_floor: Callable[[date | None], date]  # resolves the earliest ingest date for a run
```

Wire the resolvers (import `calls_data_floor` and `crime_data_floor` from `seattle_socrata`):
- `SOURCE_SPD_CRIME` → `data_floor=crime_data_floor`
- `SOURCE_SPD_ARRESTS` → `data_floor=crime_data_floor`
- `SOURCE_SPD_911` → `data_floor=calls_data_floor`

### 3 · Resolve at the consumer (`app/api/routes_admin_crime.py`)

`data_floor=crime_source.data_floor` → `data_floor=crime_source.data_floor(date.today())`.
This is the only place `CrimeSource.data_floor` is read (verified: grep shows exactly one
consumer). The `SeattleSocrataClient` still receives a concrete `date`.

## Data flow

Admin ingest handler → `get_crime_source(source)` → `crime_source.data_floor(date.today())`
resolves the concrete floor for this run (rolling for calls, fixed for crime/arrests) →
`SeattleSocrataClient(data_floor=...)` → `floor_start_date` clamps the requested start. Only
*what floor value the calls source resolves to* changes; the clamping path is identical.

## Error handling / edge cases

- **Leap day:** anchoring to the 1st avoids Feb-29 `replace(year=...)` errors; the day is
  always valid.
- **Determinism under test:** production passes `date.today()`; tests pass a fixed reference so
  assertions are exact (`calls_data_floor(date(2027,3,15)) == date(2025,3,1)`).
- **Window size knob:** `CALLS_WINDOW_MONTHS = 24` is a named constant; lowering it (e.g. to 12
  for lighter dev volume) is a one-line change, preserving the old comment's guidance.
- **No behavior regression for crime/arrests:** `crime_data_floor` returns the same
  `CRIME_DATA_FLOOR` the static field held.

## Testing

- `tests` for `calls_data_floor`: `calls_data_floor(date(2026,7,2)) == date(2024,7,1)` (matches
  the retired constant), `calls_data_floor(date(2027,3,15)) == date(2025,3,1)` (rolls forward),
  first-of-month anchoring holds for a mid-month reference.
- `crime_data_floor(<any date>) == date(2018,1,1)` (fixed, ignores `today`).
- The `CrimeSource` resolvers: `sources_for_layer`-adjacent — assert
  `CRIME_SOURCES[SOURCE_SPD_911].data_floor(date(2026,7,2)) == date(2024,7,1)` and the
  crime/arrest sources resolve to `CRIME_DATA_FLOOR`.
- Update any existing test that imports the retired `CALLS_DATA_FLOOR` constant to use the
  helper (grep `CALLS_DATA_FLOOR` across `tests/`).

## Verification gate

`make test-all` from the worktree (backend change; full gate runs per convention).

## Roadmap tick

On merge, update the C4 line in `docs/ROADMAP.md`: the `CALLS_DATA_FLOOR` drift is fixed — the
911 floor is now a rolling first-of-month 24-month window computed per ingest run; the arrest
taxonomy crosswalk remains the last deferred C4 follow-up.
