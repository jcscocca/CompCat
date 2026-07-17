from __future__ import annotations

from dataclasses import asdict
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.analysis.area_baselines import load_mcpp_areas, load_mcpp_polygons, normalize_mcpp
from app.analysis.beat_baselines import (
    BeatPolygons,
    load_beat_areas,
    load_beat_polygons,
)
from app.api.dashboard_schemas import (
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
    DashboardIncidentDetailsRequest,
    DashboardIncidentPointsRequest,
    GeocodeResultSchema,
)
from app.api.deps import required_public_user_hash
from app.config import get_settings
from app.crime.sources import LAYER_REPORTED, sources_for_layer
from app.db import get_session
from app.geocoding.providers import GeocodeProvider, GeocoderUpstreamError, build_provider
from app.services.beat_geometry_service import beats_geojson_payloads
from app.services.crime_service import dashboard_freshness_by_layer
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
    incident_details_for_places,
)
from app.services.geocoding_service import search_addresses
from app.services.incident_points_service import incident_points
from app.services.mcpp_geometry_service import mcpp_geojson_payloads
from app.services.neighborhood_service import neighborhood_analysis_for_places
from app.services.trends_service import trends_for_mcpp

router = APIRouter()


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@lru_cache(maxsize=1)
def _beat_polygons() -> BeatPolygons:
    return load_beat_polygons()


@lru_cache(maxsize=1)
def _mcpp_areas() -> dict[str, float]:
    return load_mcpp_areas()


@lru_cache(maxsize=1)
def _mcpp_polygons() -> BeatPolygons:
    return load_mcpp_polygons()


@router.post("/dashboard/analyze")
def analyze_dashboard_places(
    request: DashboardAnalyzeRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, int]:
    try:
        return analyze_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            points=request.points,
            radii_m=request.radii_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
            sources=sources_for_layer(request.layer),
            layer=request.layer,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/incidents")
def dashboard_incidents(
    request: DashboardIncidentDetailsRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return incident_details_for_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            points=request.points,
            radii_m=request.radii_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
            limit=request.limit,
            sources=sources_for_layer(request.layer),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/incident-points")
def dashboard_incident_points(
    request: DashboardIncidentPointsRequest,
    _user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return incident_points(
            session,
            bounds=request.bounds,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            layer=request.layer,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/compare")
def compare_dashboard_places(
    request: DashboardCompareRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return compare_selected_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            points=request.points,
            radius_m=request.radius_m,
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
            sources=sources_for_layer(request.layer),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/dashboard/neighborhood")
def dashboard_neighborhood(
    request: DashboardAnalyzeRequest,
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    try:
        return neighborhood_analysis_for_places(
            session=session,
            user_id_hash=user_id_hash,
            place_ids=request.place_ids,
            points=request.points,
            radius_m=request.radii_m[0],
            analysis_start_date=request.analysis_start_date,
            analysis_end_date=request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
            area_lookup=_beat_areas(),
            beat_polygons=_beat_polygons(),
            mcpp_area_lookup=_mcpp_areas(),
            mcpp_polygons=_mcpp_polygons(),
            sources=sources_for_layer(request.layer),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/dashboard/freshness")
def dashboard_freshness(
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, object]:
    # Coverage of the shared incident dataset per layer (global, not user-scoped); the
    # session gate just keeps it on the authenticated public tier like its siblings. The
    # frontend pill shows the entry for the active layer.
    return dashboard_freshness_by_layer(session)


@router.get("/dashboard/trends")
def dashboard_trends(
    _user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    mcpp: Annotated[str, Query(max_length=80)],
    layer: Annotated[str, Query(max_length=20)] = LAYER_REPORTED,
    category: Annotated[str | None, Query(max_length=80)] = None,
) -> dict[str, object]:
    try:
        sources_for_layer(layer)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    name = normalize_mcpp(mcpp)
    if name is None or name not in _mcpp_areas():
        raise HTTPException(status_code=404, detail="Unknown MCPP")
    return trends_for_mcpp(session, mcpp=name, layer=layer, offense_category=category)


@router.get("/dashboard/beats")
def dashboard_beats(
    request: Request,
    _user_id_hash: Annotated[str, Depends(required_public_user_hash)],
) -> Response:
    """SPD beat polygons for the map's outline layer (static bundled data)."""
    # Negotiation is hand-rolled: global GZipMiddleware would wrap the /assistant/chat SSE
    # StreamingResponse and break its incremental flush, and per-request middleware
    # compression would defeat the once-cached gzip bytes.
    raw, gzipped = beats_geojson_payloads()
    headers = {"Cache-Control": "public, max-age=3600", "Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("accept-encoding", "").lower():
        headers["Content-Encoding"] = "gzip"
        return Response(content=gzipped, media_type="application/geo+json", headers=headers)
    return Response(content=raw, media_type="application/geo+json", headers=headers)


@router.get("/dashboard/mcpp")
def dashboard_mcpp(
    request: Request,
    _user_id_hash: Annotated[str, Depends(required_public_user_hash)],
) -> Response:
    """SPD MCPP (neighborhood) polygons for map/locator layers (static bundled data)."""
    # Negotiation is hand-rolled: global GZipMiddleware would wrap the /assistant/chat SSE
    # StreamingResponse and break its incremental flush, and per-request middleware
    # compression would defeat the once-cached gzip bytes.
    raw, gzipped = mcpp_geojson_payloads()
    headers = {"Cache-Control": "public, max-age=3600", "Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("accept-encoding", "").lower():
        headers["Content-Encoding"] = "gzip"
        return Response(content=gzipped, media_type="application/geo+json", headers=headers)
    return Response(content=raw, media_type="application/geo+json", headers=headers)


def get_geocode_provider() -> GeocodeProvider:
    return build_provider(get_settings())


@router.get("/dashboard/geocode")
def dashboard_geocode(
    # Bound the free-text query forwarded upstream to Nominatim (an address is short); a
    # multi-KB q would otherwise bypass the query cache and pump unique long requests upstream.
    q: Annotated[str, Query(max_length=200)],
    user_id_hash: Annotated[str, Depends(required_public_user_hash)],
    session: Annotated[Session, Depends(get_session)],
    provider: Annotated[GeocodeProvider, Depends(get_geocode_provider)],
) -> list[GeocodeResultSchema]:
    try:
        hits = search_addresses(session, get_settings(), q, provider=provider)
    except GeocoderUpstreamError as exc:
        raise HTTPException(status_code=502, detail="Geocoding upstream unavailable.") from exc
    return [GeocodeResultSchema(**asdict(hit)) for hit in hits]
