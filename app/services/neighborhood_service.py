from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from datetime import date
from math import pi
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import (
    BeatPolygons,
    assign_beat,
    beats_intersecting_buffer,
    place_vs_beat,
)
from app.analysis.exposure import trim_partial_edge_months
from app.analysis.rate_tests import (
    benjamini_hochberg,
    compare_incident_rates,
    dispersion_status,
)
from app.analysis.temporal import build_temporal_profile
from app.api.dashboard_schemas import AnalysisPoint
from app.crime.sources import SOURCE_SPD_CRIME
from app.models import CrimeIncident
from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.analysis_points import point_clusters
from app.services.crime_service import _cluster_data, _incident_data
from app.services.dashboard_analysis_service import (
    _analysis_datetime_bounds,
    _filtered_incidents,
    _selected_clusters,
    validate_date_range,
)


def _analysis_days(start: date, end: date) -> int:
    return (end - start).days + 1


def _place_exposure_km2_days(radius_m: int, days: int) -> float:
    return (pi * radius_m * radius_m / 1_000_000.0) * days


def _month_key(incident: CrimeIncidentData) -> tuple[int, int]:
    observed = incident.offense_start_utc or incident.report_utc
    return (observed.year, observed.month)


def _months(start: date, end: date) -> list[tuple[int, int]]:
    months, year, month = [], start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def _monthly_counts(incidents: list[CrimeIncidentData], start: date, end: date) -> list[int]:
    keys = [_month_key(i) for i in incidents]
    return [keys.count(m) for m in _months(start, end)]


def _incidents_in_radius(
    cluster: PlaceClusterData, incidents: list[CrimeIncidentData], radius_m: int
) -> list[CrimeIncidentData]:
    lat, lon = cluster.display_latitude, cluster.display_longitude
    out = []
    for incident in incidents:
        if incident.latitude is None or incident.longitude is None:
            continue
        if haversine_m(lat, lon, incident.latitude, incident.longitude) <= radius_m:
            out.append(incident)
    return out


def _assign_beat(cluster: PlaceClusterData, beat_polygons: BeatPolygons) -> str | None:
    # Beat is fixed geography: assign the place to the SPD beat polygon that contains its
    # display point. A true point-in-polygon test (vs. the old plurality vote of nearby
    # incidents' beats) assigns places near a beat boundary correctly, which keeps the
    # rest-of-beat baseline honest.
    if cluster.display_latitude is None or cluster.display_longitude is None:
        return None
    return assign_beat(cluster.display_longitude, cluster.display_latitude, beat_polygons)


def _area_incidents(
    session: Session,
    column,
    values: Sequence[str],
    start: date,
    end: date,
    offense_category,
    offense_subcategory,
    nibrs_group,
    sources: Sequence[str] | None = None,
) -> list[CrimeIncidentData]:
    """Incidents in the window whose area attribute (``CrimeIncident.beat`` or
    ``CrimeIncident.mcpp``) is one of ``values`` — attribute bucketing, not a spatial
    join, so it is robust to SPD's block-level coordinate fuzzing."""
    effective_sources = tuple(sources) if sources is not None else (SOURCE_SPD_CRIME,)
    start_at, end_at = _analysis_datetime_bounds(start, end)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.source_dataset.in_(effective_sources))
        .where(column.in_(tuple(values)))
        .where(observed >= start_at)
        .where(observed <= end_at)
        .where(CrimeIncident.latitude.is_not(None))
    )
    if offense_category is not None:
        stmt = stmt.where(CrimeIncident.offense_category == offense_category)
    if offense_subcategory is not None:
        stmt = stmt.where(CrimeIncident.offense_subcategory == offense_subcategory)
    if nibrs_group is not None:
        stmt = stmt.where(CrimeIncident.nibrs_group == nibrs_group)
    return [_incident_data(r) for r in session.scalars(stmt).all()]


def _beat_incidents(
    session: Session,
    beats: Sequence[str],
    start: date,
    end: date,
    offense_category,
    offense_subcategory,
    nibrs_group,
    source_dataset: str = SOURCE_SPD_CRIME,
    sources: Sequence[str] | None = None,
) -> list[CrimeIncidentData]:
    effective_sources = tuple(sources) if sources is not None else (source_dataset,)
    return _area_incidents(
        session,
        CrimeIncident.beat,
        beats,
        start,
        end,
        offense_category,
        offense_subcategory,
        nibrs_group,
        sources=effective_sources,
    )


def _category_breakdown(
    place_incidents: list[CrimeIncidentData],
    baseline_incidents: list[CrimeIncidentData] | None,
    *,
    top_n: int = 6,
) -> list[dict[str, Any]]:
    """Per-category place-share vs beat-share breakdown.

    Buckets by ``offense_subcategory → offense_category → "Uncategorized"``.
    Returns the top ``top_n`` labels by place count; remaining labels are folded
    into a single ``"Other"`` row appended last.

    ``beat_share`` is each label's share of the baseline total — the beat column does NOT
    need to sum to 100 % (beat-only labels are excluded entirely). Callers pass the
    *rest-of-beat* incidents (the surrounding area with the place's own buffer carved out),
    so a row's ``place_share`` and ``beat_share`` are computed over disjoint sets — "share
    here vs. share in the surrounding area", consistent with the rate-ratio baseline.
    ``beat_share`` is ``None`` when ``baseline_incidents`` is ``None`` or empty.
    """

    def _label(inc: CrimeIncidentData) -> str:
        return inc.offense_subcategory or inc.offense_category or "Uncategorized"

    place_counter: Counter[str] = Counter(_label(i) for i in place_incidents)
    place_total = sum(place_counter.values())

    if place_total == 0:
        return []

    # Build baseline lookup only when baseline is usable.
    baseline_counter: Counter[str] = Counter()
    baseline_total = 0
    has_baseline = baseline_incidents is not None and len(baseline_incidents) > 0
    if has_baseline:
        baseline_counter = Counter(_label(i) for i in baseline_incidents)
        baseline_total = sum(baseline_counter.values())

    # Sort all place labels by count desc then label asc to get a deterministic top-N.
    sorted_labels = sorted(place_counter.keys(), key=lambda lbl: (-place_counter[lbl], lbl))
    top_labels = sorted_labels[:top_n]
    remainder_labels = sorted_labels[top_n:]

    rows: list[dict[str, Any]] = []
    for label in top_labels:
        pc = place_counter[label]
        bc = baseline_counter.get(label, 0)
        rows.append(
            {
                "label": label,
                "place_count": pc,
                "place_share": pc / place_total,
                "beat_share": (bc / baseline_total) if has_baseline else None,
            }
        )

    if remainder_labels:
        other_place = sum(place_counter[lbl] for lbl in remainder_labels)
        other_beat = sum(baseline_counter.get(lbl, 0) for lbl in remainder_labels)
        rows.append(
            {
                "label": "Other",
                "place_count": other_place,
                "place_share": other_place / place_total,
                "beat_share": (other_beat / baseline_total) if has_baseline else None,
            }
        )

    return rows


def neighborhood_analysis_for_places(
    *,
    session: Session,
    user_id_hash: str,
    place_ids: list[str] | None,
    points: list[AnalysisPoint] | None = None,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    area_lookup: dict[str, float],
    beat_polygons: BeatPolygons,
    sources: Sequence[str] | None = None,
) -> dict[str, Any]:
    validate_date_range(analysis_start_date, analysis_end_date)
    days = _analysis_days(analysis_start_date, analysis_end_date)
    clusters = (
        point_clusters(points)
        if points is not None
        else [_cluster_data(r) for r in _selected_clusters(session, user_id_hash, place_ids or [])]
    )
    buffered = _filtered_incidents(
        session,
        clusters=clusters,
        radii_m=[radius_m],
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        sources=sources,
    )

    raw, p_values = [], []
    for cluster in clusters:
        if cluster.display_latitude is None or cluster.display_longitude is None:
            raw.append({"cluster": cluster, "beat": None})
            continue
        place_incidents = _incidents_in_radius(cluster, buffered, radius_m)
        beat = _assign_beat(cluster, beat_polygons)
        area = area_lookup.get(beat) if beat else None
        if beat is None or area is None:
            raw.append({"cluster": cluster, "beat": beat, "place_incidents": place_incidents})
            continue
        # The baseline region is the union of every beat the buffer intersects (with a known
        # area), not just the assigned beat — so a buffer larger than its own tiny beat still
        # has a real surrounding area to compare against. When the buffer sits fully inside one
        # beat this degenerates to exactly the single-beat rest-of-beat baseline.
        overlaps = beats_intersecting_buffer(
            lon=cluster.display_longitude,
            lat=cluster.display_latitude,
            radius_m=radius_m,
            beat_polygons=beat_polygons,
        )
        baseline_beats = sorted(b for b in overlaps if b in area_lookup)
        if beat not in baseline_beats:  # the assigned beat always participates
            baseline_beats = sorted([*baseline_beats, beat])
        beat_incidents = _beat_incidents(
            session,
            baseline_beats,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
            sources=sources,
        )
        # Rest of the surrounding area: the baseline EXCLUDING the place's own buffer, so the
        # place is not compared against itself. Carve the buffer out by distance (incidents
        # with missing coordinates stay in the baseline, the conservative choice).
        rest_incidents = [
            incident
            for incident in beat_incidents
            if incident.latitude is None
            or incident.longitude is None
            or haversine_m(
                cluster.display_latitude,
                cluster.display_longitude,
                incident.latitude,
                incident.longitude,
            )
            > radius_m
        ]
        place_exposure = _place_exposure_km2_days(radius_m, days)
        # Pooled baseline area = Σ beat areas − Σ (buffer ∩ beat) overlaps: carve out only the
        # part of the buffer that actually lies inside each beat (subtracting the whole circle
        # would understate the rest area and bias the rate ratio low). The place's own rate
        # stays a full-buffer density.
        rest_area = sum(area_lookup[b] for b in baseline_beats) - sum(
            overlaps.get(b, 0.0) for b in baseline_beats
        )
        if rest_area <= 0 or not rest_incidents:
            raw.append(
                {
                    "cluster": cluster,
                    "beat": beat,
                    "area": area,
                    "baseline_beats": baseline_beats,
                    "place_incidents": place_incidents,
                    "baseline_too_small": True,
                }
            )
            continue
        beat_exposure = rest_area * days
        place_monthly = _monthly_counts(place_incidents, analysis_start_date, analysis_end_date)
        rest_monthly = _monthly_counts(rest_incidents, analysis_start_date, analysis_end_date)
        # Trim partial edge months from the dispersion input (not the displayed place_monthly):
        # a short first/last calendar month would otherwise inflate the overdispersion estimate.
        combined_monthly = trim_partial_edge_months(
            [p + r for p, r in zip(place_monthly, rest_monthly, strict=True)],
            analysis_start_date,
            analysis_end_date,
        )
        # Adjust and decide on the overdispersion-aware p-value so the verdict honors
        # the dispersion its own analytical detail reports (mirrors comparison.py).
        dispersion = dispersion_status(combined_monthly)
        place_test = compare_incident_rates(
            count_a=len(place_incidents),
            exposure_a=max(place_exposure, 1e-9),
            count_b=len(rest_incidents),
            exposure_b=max(beat_exposure, 1e-9),
            overdispersion_phi=dispersion.phi,
        )
        p_values.append(place_test.p_value)
        raw.append(
            {
                "cluster": cluster,
                "beat": beat,
                "area": area,
                "baseline_beats": baseline_beats,
                "place_incidents": place_incidents,
                "beat_incidents": rest_incidents,
                "place_exposure": place_exposure,
                "beat_exposure": beat_exposure,
                "place_monthly": place_monthly,
                "combined_monthly": combined_monthly,
            }
        )

    adjusted = benjamini_hochberg(p_values) if p_values else []
    adjusted_iter = iter(adjusted)

    places = []
    for entry in raw:
        cluster = entry["cluster"]
        base = {
            "place_id": cluster.id,
            "place_label": cluster.display_label or "Selected place",
            "beat": entry.get("beat"),
            # Every beat pooled into the surrounding-area baseline (== [beat] when the buffer
            # sits inside one beat); absent when no baseline could be formed at all.
            "baseline_beats": entry.get("baseline_beats"),
            "radius_m": radius_m,
        }
        if entry.get("beat") is None or entry.get("area") is None:
            places.append(
                {
                    **base,
                    "baseline_available": False,
                    "decision": "baseline_unavailable",
                    "place_incident_count": len(entry.get("place_incidents", [])),
                    "category_breakdown": _category_breakdown(
                        entry.get("place_incidents", []), None
                    ),
                    "temporal": asdict(build_temporal_profile(entry.get("place_incidents", []))),
                }
            )
            continue
        if entry.get("baseline_too_small"):
            places.append(
                {
                    **base,
                    "baseline_available": False,
                    "decision": "insufficient_data",
                    "minimum_data_status": "baseline_too_small",
                    "place_incident_count": len(entry.get("place_incidents", [])),
                    "category_breakdown": _category_breakdown(
                        entry.get("place_incidents", []), None
                    ),
                    "temporal": asdict(build_temporal_profile(entry.get("place_incidents", []))),
                }
            )
            continue
        place_incidents, beat_incidents = entry["place_incidents"], entry["beat_incidents"]
        place_monthly = entry["place_monthly"]
        result = place_vs_beat(
            place_count=len(place_incidents),
            place_exposure=entry["place_exposure"],
            beat_count=len(beat_incidents),
            beat_exposure=entry["beat_exposure"],
            combined_monthly_counts=entry["combined_monthly"],
            analysis_days=days,
            adjusted_p_value=next(adjusted_iter),
        )
        nearest = min(
            (
                haversine_m(
                    cluster.display_latitude, cluster.display_longitude, i.latitude, i.longitude
                )
                for i in place_incidents
            ),
            default=None,
        )
        places.append(
            {
                **base,
                "baseline_available": True,
                "place_incident_count": len(place_incidents),
                "beat_incident_count": len(beat_incidents),
                "place_rate": result.place_rate,
                "beat_rate": result.beat_rate,
                "rate_ratio": result.rate_ratio,
                "ci_lower": result.ci_lower,
                "ci_upper": result.ci_upper,
                "adjusted_p_value": result.adjusted_p_value,
                "exact_p_value": result.exact_p_value,
                "method": result.method,
                "overdispersion_status": result.overdispersion_status,
                "minimum_data_status": result.minimum_data_status,
                "decision": result.decision,
                "nearest_incident_m": nearest,
                "monthly_counts": place_monthly,
                "category_breakdown": _category_breakdown(place_incidents, beat_incidents),
                "temporal": asdict(build_temporal_profile(place_incidents)),
            }
        )

    return {
        "radius_m": radius_m,
        "analysis_start_date": analysis_start_date.isoformat(),
        "analysis_end_date": analysis_end_date.isoformat(),
        "offense_category": offense_category,
        "places": places,
        "pairwise": _pairwise(
            clusters, buffered, radius_m, days, analysis_start_date, analysis_end_date
        ),
    }


def _pairwise(clusters, buffered, radius_m, days, start, end):
    sized = [
        c
        for c in clusters
        if c.display_latitude is not None and c.display_longitude is not None
    ]
    if len(sized) < 2:
        return []
    exposure = _place_exposure_km2_days(radius_m, days)
    incidents_by_id = {c.id: _incidents_in_radius(c, buffered, radius_m) for c in sized}
    counts = {cid: len(incidents) for cid, incidents in incidents_by_id.items()}
    monthly_by_id = {
        cid: _monthly_counts(incs, start, end) for cid, incs in incidents_by_id.items()
    }
    pairs, p_values = [], []
    for i in range(len(sized)):
        for j in range(i + 1, len(sized)):
            a, b = sized[i], sized[j]
            # Decide each pair on the overdispersion-aware p-value from the two places' combined
            # monthly counts, exactly as the Compare tab (build_statistical_comparison) does — so
            # the two surfaces can't contradict each other on the same pair.
            combined_monthly = trim_partial_edge_months(
                [x + y for x, y in zip(monthly_by_id[a.id], monthly_by_id[b.id], strict=True)],
                start,
                end,
            )
            dispersion = dispersion_status(combined_monthly)
            test = compare_incident_rates(
                count_a=counts[a.id],
                exposure_a=max(exposure, 1e-9),
                count_b=counts[b.id],
                exposure_b=max(exposure, 1e-9),
                overdispersion_phi=dispersion.phi,
            )
            p_values.append(test.p_value)
            pairs.append(
                {
                    "a_place_id": a.id,
                    "a_label": a.display_label or "A",
                    "b_place_id": b.id,
                    "b_label": b.display_label or "B",
                    "rate_ratio": test.rate_ratio,
                    "ci_lower": test.ci_lower,
                    "ci_upper": test.ci_upper,
                    "p_value": test.p_value,
                }
            )
    adjusted = benjamini_hochberg(p_values)
    for pair, adj in zip(pairs, adjusted, strict=True):
        pair["adjusted_p_value"] = adj
    return pairs
