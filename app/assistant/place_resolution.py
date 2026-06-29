from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geocoding.providers import GeocodeProvider, GeocoderUpstreamError
from app.models import PlaceCluster
from app.places.schemas import ManualPlaceCreate
from app.services.manual_place_service import create_manual_place


@dataclass
class ResolvedPlaces:
    place_ids: list[str] = field(default_factory=list)
    matched: list[dict[str, Any]] = field(default_factory=list)
    created: list[dict[str, Any]] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)


def _normalize(label: str) -> str:
    return " ".join(label.strip().lower().split())


def _existing_by_label(session: Session, user_id_hash: str) -> dict[str, PlaceCluster]:
    rows = session.scalars(
        select(PlaceCluster).where(PlaceCluster.user_id_hash == user_id_hash)
    )
    index: dict[str, PlaceCluster] = {}
    for place in rows:
        if place.display_label:
            index.setdefault(_normalize(place.display_label), place)
    return index


def resolve_place_queries(
    session: Session,
    user_id_hash: str,
    queries: list[str],
    provider: GeocodeProvider,
) -> ResolvedPlaces:
    """Resolve free-text place queries to place ids, creating missing ones.

    A query matches an existing saved place (case-insensitive label) or is
    geocoded (top hit) and saved as a manual place. The created label is the
    user's query; the geocoder label is kept as ``address`` for narration.
    Geocoder failures / no-hits leave the query ``unresolved`` (not a hard error).
    """
    existing = _existing_by_label(session, user_id_hash)
    place_ids: list[str] = []
    matched: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    unresolved: list[str] = []

    for query in queries:
        key = _normalize(query)
        if not key:
            continue
        if key in existing:
            place = existing[key]
            place_ids.append(place.id)
            matched.append({"query": query, "place_id": place.id, "label": place.display_label})
            continue
        try:
            hits = provider.search(query)
        except GeocoderUpstreamError:
            unresolved.append(query)
            continue
        if not hits:
            unresolved.append(query)
            continue
        hit = hits[0]
        place = create_manual_place(
            session,
            user_id_hash,
            ManualPlaceCreate(
                display_label=query.strip(),
                latitude=hit.latitude,
                longitude=hit.longitude,
            ),
        )
        place_ids.append(place.id)
        created.append(
            {
                "query": query,
                "place_id": place.id,
                "label": place.display_label,
                "address": hit.label,
                "source": hit.source,
            }
        )
        existing[key] = session.get(PlaceCluster, place.id)  # dedupe repeats in one call

    return ResolvedPlaces(
        place_ids=place_ids, matched=matched, created=created, unresolved=unresolved
    )
