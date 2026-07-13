from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from datetime import date
from math import pi
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analysis.area_baselines import mcpp_display_label, sector_for_beat
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
    rate_confidence_interval,
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


# Maps the existing neighborhood_decision() outputs onto the plot's relation words.
# "model_warning" (dispersion could not be estimated) reads as insufficient — the UI
# must not claim a direction the model can't support.
_RELATION_BY_DECISION = {
    "above_clear": "above",
    "below_clear": "below",
    "not_clear": "similar",
    "insufficient_data": "insufficient",
    "model_warning": "insufficient",
}


def _baselines_for_place(
    session: Session,
    cluster: PlaceClusterData,
    place_incidents: list[CrimeIncidentData],
    *,
    radius_m: int,
    days: int,
    start: date,
    end: date,
    offense_category,
    offense_subcategory,
    nibrs_group,
    sources: Sequence[str] | None,
    area_lookup: dict[str, float],
    beat: str | None,
    beat_rest_incidents: list[CrimeIncidentData] | None,
    beat_rest_area: float | None,
    mcpp_area_lookup: dict[str, float] | None,
    mcpp_polygons: BeatPolygons | None,
    query_cache: dict[tuple, list[CrimeIncidentData]],
) -> list[dict[str, Any]]:
    """One comparison entry per resolvable baseline geography, all sharing the place's
    buffer rate. MCPP and beat are rest-of-area (buffer carved out, mirroring the legacy
    beat baseline); sector and citywide are whole-area — the buffer is negligible at
    those scales. The whole-area approximation also applies to the dispersion input: the
    place's own incidents appear in both halves of the combined monthly counts for
    sector/city, which is negligible at those scales. Geography that cannot be resolved
    (no polygon hit, no sector letter) is omitted rather than reported as a failed
    comparison, and so is a rest-of-area (mcpp/beat) entry whose rest is empty or whose
    rest area is non-positive — mirroring the legacy ``baseline_too_small`` refusal.
    Statistical inadequacy on a surviving entry (e.g. a zero-count sector/city baseline)
    reports relation="insufficient" via the decision machinery.
    """
    candidates: list[dict[str, Any]] = []

    if mcpp_polygons and mcpp_area_lookup:
        name = assign_beat(cluster.display_longitude, cluster.display_latitude, mcpp_polygons)
        if name and name in mcpp_area_lookup:
            overlaps = beats_intersecting_buffer(
                lon=cluster.display_longitude,
                lat=cluster.display_latitude,
                radius_m=radius_m,
                beat_polygons=mcpp_polygons,
            )
            names = sorted(n for n in overlaps if n in mcpp_area_lookup)
            if name not in names:
                names = sorted([*names, name])
            incidents = _area_incidents(
                session, CrimeIncident.mcpp, names, start, end,
                offense_category, offense_subcategory, nibrs_group, sources=sources,
            )
            rest = [
                incident
                for incident in incidents
                if incident.latitude is None
                or incident.longitude is None
                or haversine_m(
                    cluster.display_latitude, cluster.display_longitude,
                    incident.latitude, incident.longitude,
                )
                > radius_m
            ]
            rest_area = sum(mcpp_area_lookup[n] for n in names) - sum(
                overlaps.get(n, 0.0) for n in names
            )
            if rest_area > 0 and rest:
                candidates.append(
                    {"kind": "mcpp", "label": mcpp_display_label(name), "incidents": rest,
                     "area_km2": rest_area}
                )

    if beat is not None and beat_rest_incidents and beat_rest_area and beat_rest_area > 0:
        candidates.append(
            {"kind": "beat", "label": f"Beat {beat}", "incidents": beat_rest_incidents,
             "area_km2": beat_rest_area}
        )

    sector = sector_for_beat(beat)
    if sector:
        members = sorted(b for b in area_lookup if sector_for_beat(b) == sector)
        if members:
            cache_key = ("sector", sector)
            incidents = query_cache.get(cache_key)
            if incidents is None:
                incidents = _area_incidents(
                    session, CrimeIncident.beat, members, start, end,
                    offense_category, offense_subcategory, nibrs_group, sources=sources,
                )
                query_cache[cache_key] = incidents
            candidates.append(
                {"kind": "sector", "label": f"Sector {sector}", "incidents": incidents,
                 "area_km2": sum(area_lookup[b] for b in members)}
            )

    if area_lookup:
        cache_key = ("city",)
        incidents = query_cache.get(cache_key)
        if incidents is None:
            incidents = _area_incidents(
                session, CrimeIncident.beat, sorted(area_lookup), start, end,
                offense_category, offense_subcategory, nibrs_group, sources=sources,
            )
            query_cache[cache_key] = incidents
        candidates.append(
            {"kind": "city", "label": "Citywide", "incidents": incidents,
             "area_km2": sum(area_lookup.values())}
        )

    if not candidates:
        return []

    place_exposure = _place_exposure_km2_days(radius_m, days)
    place_monthly = _monthly_counts(place_incidents, start, end)
    prepared, p_values = [], []
    for cand in candidates:
        baseline_monthly = _monthly_counts(cand["incidents"], start, end)
        combined_monthly = trim_partial_edge_months(
            [p + b for p, b in zip(place_monthly, baseline_monthly, strict=True)], start, end
        )
        dispersion = dispersion_status(combined_monthly)
        exposure = cand["area_km2"] * days
        test = compare_incident_rates(
            count_a=len(place_incidents),
            exposure_a=max(place_exposure, 1e-9),
            count_b=len(cand["incidents"]),
            exposure_b=max(exposure, 1e-9),
            overdispersion_phi=dispersion.phi,
        )
        p_values.append(test.p_value)
        prepared.append((cand, combined_monthly, exposure))

    entries = []
    # BH within the place across its baseline comparisons (nested, correlated references
    # presented together — one adjustment family per place, like the pairwise section).
    for (cand, combined_monthly, exposure), adjusted in zip(
        prepared, benjamini_hochberg(p_values), strict=True
    ):
        result = place_vs_beat(
            place_count=len(place_incidents),
            place_exposure=place_exposure,
            beat_count=len(cand["incidents"]),
            beat_exposure=exposure,
            combined_monthly_counts=combined_monthly,
            analysis_days=days,
            adjusted_p_value=adjusted,
        )
        entries.append(
            {
                "kind": cand["kind"],
                "label": cand["label"],
                "area_km2": cand["area_km2"],
                "baseline_incident_count": len(cand["incidents"]),
                "baseline_rate": result.beat_rate,
                "rate_ratio": result.rate_ratio,
                "ci_lower": result.ci_lower,
                "ci_upper": result.ci_upper,
                "adjusted_p_value": result.adjusted_p_value,
                "method": result.method,
                "relation": _RELATION_BY_DECISION.get(result.decision, "insufficient"),
            }
        )
    return entries


def _place_rate_fields(
    place_incidents: list[CrimeIncidentData], radius_m: int, days: int, start: date, end: date
) -> dict[str, Any]:
    """The place's own exposure-adjusted rate with a quasi-Poisson interval — same
    helper and same own-monthly-dispersion convention as the Compare tab's per-address
    interval, so the two surfaces share one variance model."""
    exposure = _place_exposure_km2_days(radius_m, days)
    if exposure <= 0:
        return {}
    monthly = trim_partial_edge_months(
        _monthly_counts(place_incidents, start, end), start, end
    )
    dispersion = dispersion_status(monthly)
    interval = rate_confidence_interval(
        count=len(place_incidents), exposure=exposure, overdispersion_phi=dispersion.phi
    )
    return {
        "place_rate": len(place_incidents) / exposure,
        "place_rate_ci_lower": interval.ci_lower,
        "place_rate_ci_upper": interval.ci_upper,
    }


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
    mcpp_area_lookup: dict[str, float] | None = None,
    mcpp_polygons: BeatPolygons | None = None,
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
                "rest_area": rest_area,
                "place_monthly": place_monthly,
                "combined_monthly": combined_monthly,
            }
        )

    adjusted = benjamini_hochberg(p_values) if p_values else []
    adjusted_iter = iter(adjusted)

    places = []
    # Sector/city baselines are place-independent; compute each once per request.
    baseline_query_cache: dict[tuple, list[CrimeIncidentData]] = {}
    for entry in raw:
        cluster = entry["cluster"]
        place_stats = (
            {}
            if cluster.display_latitude is None or cluster.display_longitude is None
            else _place_rate_fields(
                entry.get("place_incidents", []),
                radius_m,
                days,
                analysis_start_date,
                analysis_end_date,
            )
        )
        baselines = (
            []
            if cluster.display_latitude is None or cluster.display_longitude is None
            else _baselines_for_place(
                session,
                cluster,
                entry.get("place_incidents", []),
                radius_m=radius_m,
                days=days,
                start=analysis_start_date,
                end=analysis_end_date,
                offense_category=offense_category,
                offense_subcategory=offense_subcategory,
                nibrs_group=nibrs_group,
                sources=sources,
                area_lookup=area_lookup,
                beat=entry.get("beat"),
                beat_rest_incidents=entry.get("beat_incidents"),
                beat_rest_area=entry.get("rest_area"),
                mcpp_area_lookup=mcpp_area_lookup,
                mcpp_polygons=mcpp_polygons,
                query_cache=baseline_query_cache,
            )
        )
        base = {
            "place_id": cluster.id,
            "place_label": cluster.display_label or "Selected place",
            "beat": entry.get("beat"),
            # Every beat pooled into the surrounding-area baseline (== [beat] when the buffer
            # sits inside one beat); absent when no baseline could be formed at all.
            "baseline_beats": entry.get("baseline_beats"),
            "radius_m": radius_m,
            "baselines": baselines,
            **place_stats,
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
