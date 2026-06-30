# Category Breakdown — Design (Phase 4, C2)

> Status: approved via brainstorming 2026-06-29. Branches from `main` (`a4bf216`, post-C1).
> **Descriptive place-vs-beat composition by subcategory**, on the Places Analyze tab. No
> per-category significance testing (deferred — see Non-goals). Builds on the C1/#57 Analyze-tab
> pattern now on `main`.

## Objective

Show **which incident types** make up the reported-incident context near a place, and how that
mix compares to the surrounding area — e.g. "12% of nearby reported incidents were car prowl, vs
5% across the surrounding beat." Today `_type_mix` shows only the place's raw top-6 counts; this
adds the **beat-baseline comparison** so users see what's over/under-represented near the place,
descriptively (no significance claims).

## Approved decisions

| Decision | Choice |
|---|---|
| Rigor | **Descriptive** place-vs-beat shares — no per-category rate-ratio / BH significance |
| Taxonomy | **Subcategory** (`offense_subcategory` → `offense_category` → `"Uncategorized"`), top-N + "Other" |
| Baseline | **Rest-of-beat** (the surroundings excluding the place buffer — same baseline the rate-ratio uses) |
| Surface | **Places Analyze tab** only |
| Data field | **Evolve `type_mix` → `category_breakdown`** (richer); not a parallel field |

## Current context

- `_type_mix(incidents)` (`app/services/neighborhood_service.py`) returns the place's top-6
  `{label, count}` and is attached to the per-place result at **three** branches:
  `baseline_unavailable`, `insufficient_data` / `baseline_too_small`, and the full-result branch.
  Only the full branch has the rest-of-beat incident list (`rest_incidents`, carved out by
  distance from the whole-beat load).
- `type_mix` is consumed **only** by `AnalyzeTab.tsx` (verified: not by `app/assistant/*`,
  exports, or `summaries.py`), so evolving it is contained.
- Display today: a plain `<li>{label} · {count}</li>` list in the Analyze card's detail area.

## Design

### Backend — `_category_breakdown` (new, in `neighborhood_service.py`)

```
_category_breakdown(place_incidents, baseline_incidents, *, top_n=6) -> list[dict]
```

- `baseline_incidents` is `list | None` (None when there is no beat baseline).
- Bucket each list by `offense_subcategory or offense_category or "Uncategorized"`.
- Take the **top `top_n` labels by place count**; fold the remaining place categories into a
  single **"Other"** row (so the list stays bounded and the shares still sum to 100%).
- Per row return `{ label, place_count, place_share, beat_share }`:
  - `place_share = place_count / place_total` (0.0 when `place_total == 0`).
  - `beat_share = baseline_count_for_label / baseline_total`, or **`null`** when
    `baseline_incidents is None` or `baseline_total == 0`. (The "Other" row's `beat_share`
    aggregates the same set of non-top labels in the baseline.)
- Pure function (no DB/IO); deterministic ordering (by place_count desc, then label).

**Interpretation (important for the display):** each row is an **independent per-type
comparison** — "this type's share *here* vs its share *in the beat*." The `beat_share` column is
NOT a second normalized distribution and need not sum to 100%: types that occur in the beat but
not near the place are simply not listed. Render it as per-row "X% here · Y% nearby", never as two
competing pie charts.

### Service wiring

Replace the three `type_mix` attachments with `category_breakdown`:
- **full branch:** `_category_breakdown(place_incidents, rest_incidents)`.
- **baseline_unavailable / insufficient / baseline_too_small:** `_category_breakdown(place_incidents, None)`.

### Schema (`app/routers/dashboard_schemas.py`)

Swap the per-place `type_mix` model field for
`category_breakdown: list[CategoryShare]`, with `CategoryShare = { label: str, place_count: int,
place_share: float, beat_share: float | None }`.

### Frontend (`AnalyzeTab.tsx`, `types.ts`)

- `types.ts`: replace `type_mix` with `category_breakdown` of the shape above.
- Replace the raw `<li>` list with a compact **"Incident types"** breakdown in the same detail
  area of the card (progressive — stays secondary to the verdict). Per row: the subcategory
  label and its **place share vs beat share** — a small two-value bar (place vs beat) or
  "12% here · 5% nearby"; when `beat_share` is `null`, show place share + count only. Neutral
  palette (no danger coloring).
- Update the existing `AnalyzeTab` test fixture (`type_mix` → `category_breakdown`).

## Invariant (must hold)

Descriptive composition only. Copy states shares/counts ("X% of nearby reported incidents were
<type>, vs Y% across the surrounding beat"); it must NOT imply danger, rank types as bad, or make
significance claims (no "significantly more"). Numbers + neutral copy; the API returns numbers
only.

## Error / edge cases

- No beat baseline (degraded branches) → `beat_share` null; render place share + count only.
- `place_total == 0` (place with no in-radius incidents) → empty breakdown / existing empty state.
- A label present near the place but absent in the beat → `beat_share = 0.0` (not null).
- "Other" row only appears when there are more than `top_n` distinct place labels.

## Testing

**Backend**
- `_category_breakdown`: bucketing by subcategory||category||Uncategorized; top-N selection + the
  "Other" fold; `place_share`/`beat_share` math; `null` baseline → null beat_share; label present
  near place but not in beat → 0.0; empty place list → empty; deterministic ordering.
- Service: `category_breakdown` attached in all three branches; full branch carries non-null
  beat shares, degraded branches carry null.
- API contract: `/dashboard/neighborhood` response includes `category_breakdown` with the right
  shape; no `type_mix` left behind.

**Frontend**
- `AnalyzeTab`: renders place-vs-beat shares; a null-baseline place shows place-only; the "Other"
  row renders; empty breakdown hides the section. No safety/ranking copy.

**Gate:** `make test-all`.

## Non-goals

- Per-category significance (rate-ratio per category + BH correction) — the deferred "comparative"
  option; would reopen the multiple-comparison surface and needs a methodology doc.
- Compare / Routes / assistant surfaces; an assistant `category` tool.
- Broad-category or two-level (grouped) taxonomy.
- Any new ingestion or schema migration on `crime_incidents`.

## Roadmap tick

Marks **Phase 4 · C2** done. `main` already has the Phase 4 section (from #71), so — unlike the
parallel H3/H1 work — this branch can tick `C2 → [x]` directly (no integration deferral needed,
since no other in-flight PR is touching the Phase 4 list).
