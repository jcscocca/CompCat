from __future__ import annotations

from datetime import date
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

from app.crime.sources import LAYER_REPORTED, LAYERS

DashboardRadiusMeters = Annotated[int, Field(gt=0, le=5000)]

# Seattle-metro bounds (lon W/E, lat S/N) — mirrors config.geocoder_viewbox and
# frontend SEATTLE_BBOX. A shared-view point must resolve inside Seattle.
_SEATTLE_WEST, _SEATTLE_EAST = -122.55, -122.10
_SEATTLE_SOUTH, _SEATTLE_NORTH = 47.43, 47.78
_MAX_POINTS = 10


def _validate_layer(value: str) -> str:
    if value not in LAYERS:
        allowed = ", ".join(sorted(LAYERS))
        raise ValueError(f"layer must be one of: {allowed}")
    return value


class AnalysisPoint(BaseModel):
    latitude: float
    longitude: float
    label: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def within_seattle(self) -> AnalysisPoint:
        if not (_SEATTLE_SOUTH <= self.latitude <= _SEATTLE_NORTH
                and _SEATTLE_WEST <= self.longitude <= _SEATTLE_EAST):
            raise ValueError("point is outside the Seattle area")
        return self


class MapBounds(BaseModel):
    """A map viewport; must intersect the Seattle area the data covers."""

    west: float
    south: float
    east: float
    north: float

    @model_validator(mode="after")
    def must_intersect_seattle(self) -> MapBounds:
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("bounds are empty or inverted")
        if (
            self.east < _SEATTLE_WEST
            or self.west > _SEATTLE_EAST
            or self.north < _SEATTLE_SOUTH
            or self.south > _SEATTLE_NORTH
        ):
            raise ValueError("bounds are outside the Seattle area")
        return self


class DashboardIncidentPointsRequest(BaseModel):
    bounds: MapBounds
    analysis_start_date: date
    analysis_end_date: date
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def layer_must_be_known(self) -> DashboardIncidentPointsRequest:
        _validate_layer(self.layer)
        return self


class DashboardAnalyzeRequest(BaseModel):
    place_ids: list[str] | None = Field(default=None, min_length=1)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=1, max_length=_MAX_POINTS)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[DashboardRadiusMeters] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    # Which incident-context layer to query: "reported" (SPD crime reports), "arrests" (SPD
    # arrest records — enforcement activity, kept separate from reported incidents), or
    # "calls" (911 calls for service). The layers are mutually exclusive by design.
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def exactly_one_selection(self) -> DashboardAnalyzeRequest:
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        return self

    @field_validator("radii_m")
    @classmethod
    def radii_m_values_must_be_unique(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("radii_m values must be unique")
        return value

    @field_validator("layer")
    @classmethod
    def layer_must_be_known(cls, value: str) -> str:
        return _validate_layer(value)


class DashboardCompareRequest(BaseModel):
    place_ids: list[str] | None = Field(default=None, min_length=2)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=2, max_length=_MAX_POINTS)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: DashboardRadiusMeters
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def exactly_one_selection(self) -> DashboardCompareRequest:
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        return self

    @field_validator("layer")
    @classmethod
    def layer_must_be_known(cls, value: str) -> str:
        return _validate_layer(value)


class DashboardIncidentDetailsRequest(DashboardAnalyzeRequest):
    limit: int = Field(default=100, ge=1, le=500)


class GeocodeResultSchema(BaseModel):
    label: str
    latitude: float
    longitude: float
    source: str
