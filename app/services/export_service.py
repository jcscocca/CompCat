from __future__ import annotations

import json
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.area_baselines import (
    load_mcpp_areas,
    load_mcpp_polygons,
)
from app.analysis.beat_baselines import load_beat_areas, load_beat_polygons
from app.crime.sources import sources_for_layer
from app.exports.analysis import build_analysis_csv
from app.exports.tableau import SENSITIVE_CLASSES, build_place_summary_csv
from app.models import AnalysisRun, PlaceCluster, PlaceCrimeSummary
from app.schemas import PlaceCrimeSummaryData
from app.services.analysis_runs import latest_analysis_run_id
from app.services.crime_service import _cluster_data
from app.services.neighborhood_service import neighborhood_analysis_for_places


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@lru_cache(maxsize=1)
def _beat_polygons():
    return load_beat_polygons()


@lru_cache(maxsize=1)
def _mcpp_areas() -> dict[str, float]:
    return load_mcpp_areas()


@lru_cache(maxsize=1)
def _mcpp_polygons():
    return load_mcpp_polygons()


def tableau_place_summary_csv(
    session: Session, user_id_hash: str, run_id: str | None = None
) -> str:
    clusters = [
        _cluster_data(row)
        for row in session.scalars(
            select(PlaceCluster).where(PlaceCluster.user_id_hash == user_id_hash)
        ).all()
    ]
    if run_id is not None:
        run = session.get(AnalysisRun, run_id)
        if run is None or run.user_id_hash != user_id_hash:
            raise LookupError("analysis run not found")
        scoped_run_id = run.id
    else:
        scoped_run_id = latest_analysis_run_id(session, user_id_hash)
    summaries = (
        [
            _summary_data(row)
            for row in session.scalars(
                select(PlaceCrimeSummary).where(
                    PlaceCrimeSummary.analysis_run_id == scoped_run_id
                )
            ).all()
        ]
        if scoped_run_id is not None
        else []
    )
    return build_place_summary_csv(clusters, summaries, tableau_safe=True)


def analysis_run_csv(session: Session, user_id_hash: str, run_id: str) -> str:
    run = session.get(AnalysisRun, run_id)
    if run is None or run.user_id_hash != user_id_hash:
        raise LookupError("analysis run not found")

    place_ids = _analysis_run_place_ids(session, run)
    if not place_ids:
        return _empty_analysis_csv(run)

    rows = session.scalars(
        select(PlaceCluster).where(
            PlaceCluster.user_id_hash == user_id_hash,
            PlaceCluster.id.in_(place_ids),
        )
    ).all()
    exportable_ids = {
        row.id for row in rows if row.sensitivity_class not in SENSITIVE_CLASSES
    }
    selected_ids = [place_id for place_id in place_ids if place_id in exportable_ids]
    if not selected_ids:
        return _empty_analysis_csv(run)

    radii = json.loads(run.radii_m_json)
    if not isinstance(radii, list) or not radii:
        raise LookupError("analysis run has no radius")
    radius_m = int(radii[0])
    layer = run.layer or "reported"
    analysis = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=selected_ids,
        radius_m=radius_m,
        analysis_start_date=run.analysis_start_date,
        analysis_end_date=run.analysis_end_date,
        offense_category=run.offense_category,
        offense_subcategory=run.offense_subcategory,
        nibrs_group=run.nibrs_group,
        area_lookup=_beat_areas(),
        beat_polygons=_beat_polygons(),
        mcpp_area_lookup=_mcpp_areas(),
        mcpp_polygons=_mcpp_polygons(),
        sources=sources_for_layer(layer),
    )
    return build_analysis_csv(
        analysis,
        analysis_start_date=run.analysis_start_date,
        analysis_end_date=run.analysis_end_date,
        layer=layer,
        offense_subcategory=run.offense_subcategory,
        nibrs_group=run.nibrs_group,
    )


def _analysis_run_place_ids(session: Session, run: AnalysisRun) -> list[str]:
    if run.place_ids_json:
        try:
            decoded = json.loads(run.place_ids_json)
        except (TypeError, ValueError):
            decoded = None
        if isinstance(decoded, list) and all(isinstance(value, str) for value in decoded):
            return list(dict.fromkeys(decoded))

    # Pre-0016 runs do not record selections. Their attached summaries are the best available
    # provenance, and keep historical non-zero runs exportable after the migration.
    return list(
        dict.fromkeys(
            session.scalars(
                select(PlaceCrimeSummary.place_cluster_id).where(
                    PlaceCrimeSummary.analysis_run_id == run.id
                )
            ).all()
        )
    )


def _empty_analysis_csv(run: AnalysisRun) -> str:
    return build_analysis_csv(
        {
            "radius_m": "",
            "offense_category": run.offense_category,
            "places": [],
        },
        analysis_start_date=run.analysis_start_date,
        analysis_end_date=run.analysis_end_date,
        layer=run.layer or "reported",
        offense_subcategory=run.offense_subcategory,
        nibrs_group=run.nibrs_group,
    )


def _summary_data(row: PlaceCrimeSummary) -> PlaceCrimeSummaryData:
    return PlaceCrimeSummaryData(
        id=row.id,
        user_id_hash=row.user_id_hash,
        place_cluster_id=row.place_cluster_id,
        radius_m=row.radius_m,
        analysis_start_date=row.analysis_start_date,
        analysis_end_date=row.analysis_end_date,
        offense_category=row.offense_category,
        offense_subcategory=row.offense_subcategory,
        nibrs_group=row.nibrs_group,
        incident_count=row.incident_count,
        nearest_incident_m=row.nearest_incident_m,
        incidents_per_visit=row.incidents_per_visit,
        incidents_per_hour_dwell=row.incidents_per_hour_dwell,
        layer=row.layer,
    )
