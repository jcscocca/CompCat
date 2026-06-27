from __future__ import annotations

from collections import Counter
from datetime import date
from math import pi
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import NON_GEOGRAPHIC_BEATS, place_vs_beat
from app.analysis.rate_tests import (
    benjamini_hochberg,
    compare_incident_rates,
    dispersion_status,
)
from app.models import CrimeIncident
from app.normalization.geo import haversine_m
from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.crime_service import _cluster_data, _incident_data
from app.services.dashboard_analysis_service import (
    _analysis_datetime_bounds,
    _filtered_incidents,
    _incident_bounding_boxes,
    _selected_clusters,
    _validate_date_range,
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


def _assign_beat(session: Session, cluster: PlaceClusterData, radius_m: int) -> str | None:
    box = _incident_bounding_boxes([cluster], radius_m)
    if not box:
        return None
    # Beat is fixed geography: assign from ALL nearby incidents, ignoring date/offense filters.
    rows = session.scalars(select(CrimeIncident).where(or_(*box))).all()
    near = _incidents_in_radius(cluster, [_incident_data(r) for r in rows], radius_m)
    beats = Counter(i.beat for i in near if i.beat and i.beat not in NON_GEOGRAPHIC_BEATS)
    return beats.most_common(1)[0][0] if beats else None


def _beat_incidents(
    session: Session,
    beat: str,
    start: date,
    end: date,
    offense_category,
    offense_subcategory,
    nibrs_group,
) -> list[CrimeIncidentData]:
    start_at, end_at = _analysis_datetime_bounds(start, end)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.beat == beat)
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


def _type_mix(incidents: list[CrimeIncidentData]) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    for incident in incidents:
        label = incident.offense_subcategory or incident.offense_category or "Uncategorized"
        counter[label] += 1
    return [{"label": label, "count": count} for label, count in counter.most_common(6)]


def neighborhood_analysis_for_places(
    *,
    session: Session,
    user_id_hash: str,
    place_ids: list[str],
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    area_lookup: dict[str, float],
) -> dict[str, Any]:
    _validate_date_range(analysis_start_date, analysis_end_date)
    days = _analysis_days(analysis_start_date, analysis_end_date)
    clusters = [_cluster_data(r) for r in _selected_clusters(session, user_id_hash, place_ids)]
    buffered = _filtered_incidents(
        session,
        clusters=clusters,
        radii_m=[radius_m],
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
    )

    raw, p_values = [], []
    for cluster in clusters:
        if cluster.display_latitude is None or cluster.display_longitude is None:
            raw.append({"cluster": cluster, "beat": None})
            continue
        place_incidents = _incidents_in_radius(cluster, buffered, radius_m)
        beat = _assign_beat(session, cluster, radius_m)
        area = area_lookup.get(beat) if beat else None
        if beat is None or area is None:
            raw.append({"cluster": cluster, "beat": beat, "place_incidents": place_incidents})
            continue
        beat_incidents = _beat_incidents(
            session,
            beat,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
        )
        # Rest of beat: the surrounding baseline EXCLUDING the place's own buffer, so the
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
        buffer_km2 = pi * radius_m * radius_m / 1_000_000.0
        rest_area = area - buffer_km2
        if rest_area <= 0 or not rest_incidents:
            raw.append(
                {
                    "cluster": cluster,
                    "beat": beat,
                    "area": area,
                    "place_incidents": place_incidents,
                    "baseline_too_small": True,
                }
            )
            continue
        beat_exposure = rest_area * days
        place_monthly = _monthly_counts(place_incidents, analysis_start_date, analysis_end_date)
        rest_monthly = _monthly_counts(rest_incidents, analysis_start_date, analysis_end_date)
        combined_monthly = [p + r for p, r in zip(place_monthly, rest_monthly, strict=True)]
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
            "radius_m": radius_m,
        }
        if entry.get("beat") is None or entry.get("area") is None:
            places.append(
                {
                    **base,
                    "baseline_available": False,
                    "decision": "baseline_unavailable",
                    "place_incident_count": len(entry.get("place_incidents", [])),
                    "type_mix": _type_mix(entry.get("place_incidents", [])),
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
                    "type_mix": _type_mix(entry.get("place_incidents", [])),
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
                "type_mix": _type_mix(place_incidents),
            }
        )

    return {
        "radius_m": radius_m,
        "analysis_start_date": analysis_start_date.isoformat(),
        "analysis_end_date": analysis_end_date.isoformat(),
        "offense_category": offense_category,
        "places": places,
        "pairwise": _pairwise(clusters, buffered, radius_m, days),
    }


def _pairwise(clusters, buffered, radius_m, days):
    sized = [
        c
        for c in clusters
        if c.display_latitude is not None and c.display_longitude is not None
    ]
    if len(sized) < 2:
        return []
    exposure = _place_exposure_km2_days(radius_m, days)
    counts = {c.id: len(_incidents_in_radius(c, buffered, radius_m)) for c in sized}
    pairs, p_values = [], []
    for i in range(len(sized)):
        for j in range(i + 1, len(sized)):
            a, b = sized[i], sized[j]
            test = compare_incident_rates(
                count_a=counts[a.id],
                exposure_a=max(exposure, 1e-9),
                count_b=counts[b.id],
                exposure_b=max(exposure, 1e-9),
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
