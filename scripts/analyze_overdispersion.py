"""Empirically test Poisson vs. quasi-Poisson vs. negative binomial for SPD incident counts.

Backs docs/analysis/overdispersion-and-rate-intervals.md. Pulls unit x calendar-month counts
straight from the live SPD Crime Data source (Socrata tazs-3rd5) — the local dev seed is a
uniform randint(1,3) process and is unusable for a dispersion question — then reports, at each
spatial scale, the global Pearson dispersion, the per-unit index of dispersion, a
method-of-moments negative-binomial alpha, and the log-log variance/mean slope that
discriminates quasi-Poisson (slope ~1) from negative binomial (slope ~2).

    .venv/bin/python scripts/analyze_overdispersion.py

Stdlib only; no scientific dependencies (matching the app's hand-rolled statistics core).
"""
from __future__ import annotations

import csv
import json
import math
import urllib.request
from pathlib import Path

BASE = "https://data.seattle.gov/resource/tazs-3rd5.json?$query="
_DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"
AREA_CSV = _DATA_DIR / "seattle_police_beats_2018_area.csv"


def soql(query: str) -> list[dict]:
    url = BASE + urllib.request.quote(query)
    with urllib.request.urlopen(url, timeout=90) as response:  # noqa: S310 (fixed https host)
        return json.loads(response.read().decode("utf-8"))


def month_grid(start: tuple[int, int], end: tuple[int, int]) -> list[str]:
    out: list[str] = []
    year, month = start
    while (year, month) <= end:
        out.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return out


def fetch_unit_month_counts(unit: str, start_iso: str, end_iso: str) -> dict[tuple[str, str], int]:
    counts: dict[tuple[str, str], int] = {}
    offset, page = 0, 50000
    while True:
        rows = soql(
            f"SELECT {unit} AS u, date_trunc_ym(offense_date) AS ym, count(1) AS n "
            f"WHERE offense_date >= '{start_iso}' AND offense_date < '{end_iso}' "
            f"AND {unit} IS NOT NULL "
            f"GROUP BY u, ym ORDER BY u, ym LIMIT {page} OFFSET {offset}"
        )
        for row in rows:
            counts[(row["u"], row["ym"][:7])] = int(row["n"])
        if len(rows) < page:
            return counts
        offset += page


def ols(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys, strict=True))
    ss_tot = sum((y - my) ** 2 for y in ys)
    return intercept, slope, (1 - ss_res / ss_tot if ss_tot else float("nan"))


def analyze(unit: str, start: tuple[int, int], end: tuple[int, int], *,
            keep: set[str] | None, min_total: int, label: str) -> None:
    start_iso = f"{start[0]:04d}-{start[1]:02d}-01T00:00:00"
    end_next = (end[0] + end[1] // 12, end[1] % 12 + 1)
    end_iso = f"{end_next[0]:04d}-{end_next[1]:02d}-01T00:00:00"
    grid = month_grid(start, end)
    months = len(grid)
    raw = fetch_unit_month_counts(unit, start_iso, end_iso)

    by_unit: dict[str, dict[str, int]] = {}
    for (u, ym), n in raw.items():
        if keep is not None and u not in keep:
            continue
        by_unit.setdefault(u, {})[ym] = n

    stats, dropped, pearson_num, cells, unit_count = [], 0, 0.0, 0, 0
    for _u, series in by_unit.items():
        vec = [series.get(m, 0) for m in grid]
        total = sum(vec)
        if total < min_total:
            dropped += 1
            continue
        mean = total / months
        var = sum((c - mean) ** 2 for c in vec) / (months - 1)
        stats.append((mean, var))
        if mean > 0:
            unit_count += 1
            pearson_num += sum((c - mean) ** 2 / mean for c in vec)
            cells += months

    phi_pearson = pearson_num / (cells - unit_count) if cells > unit_count else float("nan")
    phis = sorted(v / m for m, v in stats if m > 0)
    alpha_x = [m * m for m, _ in stats if m > 0]
    alpha_y = [v - m for m, v in stats if m > 0]
    alpha = sum(x * y for x, y in zip(alpha_x, alpha_y, strict=True)) / sum(x * x for x in alpha_x)
    log_pairs = [(math.log(m), math.log(v)) for m, v in stats if m > 0 and v > 0]
    intercept, slope, r2 = ols([x for x, _ in log_pairs], [y for _, y in log_pairs])

    over = sum(1 for p in phis if p > 1.2) / len(phis) * 100
    median_phi = phis[len(phis) // 2]
    print(f"\n===== {label} ({unit}) {grid[0]}..{grid[-1]} ({months} months) =====")
    print(f"units kept {len(stats)} (dropped <{min_total}: {dropped})")
    print(f"global Pearson dispersion phi_hat = {phi_pearson:.2f}  (Poisson = 1)")
    print(f"per-unit dispersion median = {median_phi:.2f}  overdispersed(>1.2) = {over:.0f}%")
    print(f"NB alpha (pooled, var = mu + alpha*mu^2) = {alpha:.4f}")
    print(f"log-log slope = {slope:.2f} (intercept {intercept:.2f}, R^2 {r2:.3f}) "
          f"[1 => quasi-Poisson, 2 => negative binomial]")


def main() -> int:
    real_beats: set[str] = set()
    with AREA_CSV.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            beat = (row.get("beat") or "").strip()
            if beat:
                real_beats.add(beat)

    analyze("beat", (2018, 1), (2025, 12), keep=real_beats, min_total=12, label="BEAT 2018-2025")
    analyze("beat", (2022, 1), (2025, 12), keep=real_beats, min_total=12, label="BEAT 2022-2025")
    analyze("reporting_area", (2022, 1), (2025, 12), keep=None, min_total=6,
            label="REPORTING-AREA 2022-2025")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
