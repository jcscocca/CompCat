from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas import new_id

SupportedRouteMode = Literal["transit", "walk", "bike", "drive"]
SupportedRoutePrivacyLevel = Literal["generalized"]
RouteRadiusMeters = Annotated[int, Field(gt=0, le=5000)]


class RouteLocation(BaseModel):
    label: str
    latitude: float
    longitude: float
    display_latitude: float | None = None
    display_longitude: float | None = None
    location_type: str = "unknown"
    source: str = "local_fixture"


class RouteRequestCreate(BaseModel):
    origin_label: str
    destination_label: str
    mode: SupportedRouteMode = "transit"
    departure_date: date | None = None
    departure_time: str | None = None
    time_window: str | None = None
    preferences: list[str] = Field(default_factory=list)
    privacy_level: SupportedRoutePrivacyLevel = "generalized"
    provider: str | None = None
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[RouteRadiusMeters] = Field(default_factory=lambda: [250, 500], min_length=1)


class RouteSegmentData(BaseModel):
    id: str = Field(default_factory=new_id)
    route_alternative_id: str | None = None
    sequence: int
    segment_type: str
    mode: str
    start_label: str
    start_latitude: float
    start_longitude: float
    end_label: str
    end_latitude: float
    end_longitude: float
    distance_m: float | None = None
    duration_minutes: float | None = None
    geometry: str | None = None


class RouteAlternativeData(BaseModel):
    id: str = Field(default_factory=new_id)
    route_request_id: str | None = None
    provider_route_id: str
    route_label: str
    rank: int
    duration_minutes: float | None = None
    distance_m: float | None = None
    transfer_count: int = 0
    walking_distance_m: float | None = None
    mode_mix: str
    summary_geometry: str | None = None
    provider: str = "mock"
    provider_metadata_json: str | None = None
    segments: list[RouteSegmentData] = Field(default_factory=list)


class RouteContextSummaryData(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id_hash: str
    route_alternative_id: str
    route_segment_id: str | None = None
    context_label: str
    context_type: str
    radius_m: int
    analysis_start_date: date
    analysis_end_date: date
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    incident_count: int
    nearest_incident_m: float | None = None
    incidents_per_route: float | None = None


class RouteRequestData(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id_hash: str
    origin: RouteLocation
    destination: RouteLocation
    mode: SupportedRouteMode
    departure_date: date | None = None
    departure_time: str | None = None
    time_window: str | None = None
    preferences: list[str] = Field(default_factory=list)
    privacy_level: SupportedRoutePrivacyLevel = "generalized"
    provider: str = "mock"
    status: str = "ready"
    created_at: datetime | None = None
