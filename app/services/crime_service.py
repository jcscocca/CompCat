from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, time
from importlib import resources
from math import cos, radians
from time import monotonic

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crime.seattle_socrata import load_crime_csv
from app.crime.summaries import summarize_place_crime
from app.models import CrimeIncident, PlaceCluster, PlaceCrimeSummary
from app.schemas import CrimeIncidentData, PlaceClusterData, PlaceCrimeSummaryData
from app.services.analysis_runs import create_analysis_run


def _as_date_str(value: object) -> str | None:
    # SQLite may return aggregate datetimes as ISO strings; Postgres returns datetimes.
    if value is None:
        return None
    if isinstance(value, str):
        return value[:10]
    return value.date().isoformat()


def _as_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


# The freshness aggregate scans the whole crime_incidents table (count(*) is O(n); the coalesce
# defeats the offense_start_utc index; snapshot_at is unindexed) and the dashboard calls it on
# every load. Cache it in-process: the dataset updates ~daily via backfill and the pill exists to
# signal the data is NOT live, so a short staleness window is invisible.
FRESHNESS_CACHE_TTL_S = 300.0
_freshness_cache: dict[str, object] | None = None
_freshness_expires: float = 0.0


def reset_freshness_cache() -> None:
    """Drop the cached freshness value (tests, or explicit invalidation)."""
    global _freshness_cache, _freshness_expires
    _freshness_cache = None
    _freshness_expires = 0.0


def _compute_freshness(session: Session) -> dict[str, object]:
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    count, data_through, earliest, last_ingested_at = session.execute(
        select(
            func.count(CrimeIncident.id),
            func.max(observed),
            func.min(observed),
            func.max(CrimeIncident.snapshot_at),
        )
    ).one()
    return {
        "incident_count": count or 0,
        "data_through": _as_date_str(data_through),
        "earliest": _as_date_str(earliest),
        "last_ingested_at": _as_iso(last_ingested_at),
    }


def crime_data_freshness(
    session: Session, *, now: Callable[[], float] = monotonic
) -> dict[str, object]:
    """Coverage/freshness of the (global, shared) reported-incident dataset: how many
    incidents, the date range they span, and when they were last ingested. Powers a
    "reported incidents through <date>" surface so users know the data isn't live.

    Cached in-process for ``FRESHNESS_CACHE_TTL_S`` to avoid a full-table aggregate on every
    dashboard load; a race only causes a redundant recompute, so no lock is needed.
    """
    global _freshness_cache, _freshness_expires
    # The cached dict is returned by reference and shared across cache hits; callers must treat
    # it as read-only (the sole caller hands it straight to JSON serialization).
    if _freshness_cache is not None and now() < _freshness_expires:
        return _freshness_cache
    value = _compute_freshness(session)
    _freshness_cache = value
    _freshness_expires = now() + FRESHNESS_CACHE_TTL_S
    return value


def ingest_sample_crime(session: Session) -> dict[str, int]:
    fixture_path = resources.files("app.data").joinpath("sample_crime.csv")
    incidents = load_crime_csv(fixture_path)
    inserted = 0
    for incident in incidents:
        if incident.external_incident_id:
            existing = session.scalar(
                select(CrimeIncident).where(
                    CrimeIncident.external_incident_id == incident.external_incident_id
                )
            )
            if existing is not None:
                continue
        session.add(_incident_model(incident))
        inserted += 1
    session.commit()
    return {"inserted_count": inserted}


def _incidents_near_clusters(
    session: Session,
    clusters: list[PlaceClusterData],
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
) -> list[CrimeIncidentData]:
    """Load only incidents within the clusters' combined bounding box and date range,
    rather than the whole ``crime_incidents`` table. ``summarize_place_crime`` re-filters
    by exact radius and date afterward, so this is a SQL pre-filter, not a behavior change.

    The bbox+date WHERE mirrors ``incident_query_service.incidents_in_bbox``; it is inlined
    here because that module imports ``_incident_data`` from this one, so importing it back
    would be a circular import.
    """
    points = [
        (cluster.display_latitude, cluster.display_longitude)
        for cluster in clusters
        if cluster.display_latitude is not None and cluster.display_longitude is not None
    ]
    if not points or not radii_m:
        return []
    radius_m = max(radii_m)
    lats = [lat for lat, _ in points]
    lons = [lon for _, lon in points]
    lat_pad = radius_m / 111_320
    lon_scale = max(abs(cos(radians(sum(lats) / len(lats)))), 0.01)
    lon_pad = radius_m / (111_320 * lon_scale)
    start_at = datetime.combine(analysis_start_date, time.min, tzinfo=UTC)
    end_at = datetime.combine(analysis_end_date, time.max, tzinfo=UTC)
    observed = func.coalesce(CrimeIncident.offense_start_utc, CrimeIncident.report_utc)
    stmt = (
        select(CrimeIncident)
        .where(CrimeIncident.latitude.is_not(None))
        .where(CrimeIncident.longitude.is_not(None))
        .where(CrimeIncident.latitude >= min(lats) - lat_pad)
        .where(CrimeIncident.latitude <= max(lats) + lat_pad)
        .where(CrimeIncident.longitude >= min(lons) - lon_pad)
        .where(CrimeIncident.longitude <= max(lons) + lon_pad)
        .where(observed >= start_at)
        .where(observed <= end_at)
    )
    return [_incident_data(row) for row in session.scalars(stmt).all()]


def summarize_for_user(
    session: Session,
    user_id_hash: str,
    radii_m: list[int],
    analysis_start_date: date,
    analysis_end_date: date,
) -> dict[str, int]:
    clusters = [
        _cluster_data(row)
        for row in session.scalars(
            select(PlaceCluster).where(PlaceCluster.user_id_hash == user_id_hash)
        ).all()
    ]
    incidents = _incidents_near_clusters(
        session, clusters, radii_m, analysis_start_date, analysis_end_date
    )
    summaries = summarize_place_crime(
        clusters,
        incidents,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
    )
    run = create_analysis_run(
        session,
        user_id_hash=user_id_hash,
        radii_m=radii_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=None,
        offense_subcategory=None,
        nibrs_group=None,
    )
    models = [_summary_model(summary) for summary in summaries]
    for model in models:
        model.analysis_run_id = run.id
    session.add_all(models)
    session.commit()
    return {"summary_count": len(summaries)}


def _incident_model(incident: CrimeIncidentData) -> CrimeIncident:
    return CrimeIncident(
        id=incident.id,
        external_incident_id=incident.external_incident_id,
        report_number=incident.report_number,
        offense_id=incident.offense_id,
        offense_start_utc=incident.offense_start_utc,
        offense_end_utc=incident.offense_end_utc,
        report_utc=incident.report_utc,
        offense_category=incident.offense_category,
        offense_subcategory=incident.offense_subcategory,
        nibrs_group=incident.nibrs_group,
        precinct=incident.precinct,
        sector=incident.sector,
        beat=incident.beat,
        mcpp=incident.mcpp,
        block_address=incident.block_address,
        latitude=incident.latitude,
        longitude=incident.longitude,
        source_dataset=incident.source_dataset,
        snapshot_at=incident.snapshot_at,
    )


def _summary_model(summary: PlaceCrimeSummaryData) -> PlaceCrimeSummary:
    return PlaceCrimeSummary(
        id=summary.id,
        user_id_hash=summary.user_id_hash,
        place_cluster_id=summary.place_cluster_id,
        radius_m=summary.radius_m,
        analysis_start_date=summary.analysis_start_date,
        analysis_end_date=summary.analysis_end_date,
        offense_category=summary.offense_category,
        offense_subcategory=summary.offense_subcategory,
        nibrs_group=summary.nibrs_group,
        incident_count=summary.incident_count,
        nearest_incident_m=float(summary.nearest_incident_m)
        if summary.nearest_incident_m is not None
        else None,
        incidents_per_visit=float(summary.incidents_per_visit)
        if summary.incidents_per_visit is not None
        else None,
        incidents_per_hour_dwell=float(summary.incidents_per_hour_dwell)
        if summary.incidents_per_hour_dwell is not None
        else None,
    )


def _cluster_data(row: PlaceCluster) -> PlaceClusterData:
    return PlaceClusterData(
        id=row.id,
        user_id_hash=row.user_id_hash,
        cluster_version=row.cluster_version,
        cluster_method=row.cluster_method,
        centroid_latitude=row.centroid_latitude,
        centroid_longitude=row.centroid_longitude,
        display_latitude=row.display_latitude,
        display_longitude=row.display_longitude,
        cluster_radius_m=row.cluster_radius_m,
        visit_count=row.visit_count,
        total_dwell_minutes=row.total_dwell_minutes,
        median_dwell_minutes=row.median_dwell_minutes,
        first_seen_utc=row.first_seen_utc,
        last_seen_utc=row.last_seen_utc,
        dominant_days=row.dominant_days,
        dominant_hours=row.dominant_hours,
        inferred_place_type=row.inferred_place_type,
        sensitivity_class=row.sensitivity_class,
        display_label=row.display_label,
        label_source=row.label_source,
    )


def _incident_data(row: CrimeIncident) -> CrimeIncidentData:
    return CrimeIncidentData(
        id=row.id,
        external_incident_id=row.external_incident_id,
        report_number=row.report_number,
        offense_id=row.offense_id,
        offense_start_utc=row.offense_start_utc,
        offense_end_utc=row.offense_end_utc,
        report_utc=row.report_utc,
        offense_category=row.offense_category,
        offense_subcategory=row.offense_subcategory,
        nibrs_group=row.nibrs_group,
        precinct=row.precinct,
        sector=row.sector,
        beat=row.beat,
        mcpp=row.mcpp,
        block_address=row.block_address,
        latitude=row.latitude,
        longitude=row.longitude,
        source_dataset=row.source_dataset,
        snapshot_at=row.snapshot_at,
    )
