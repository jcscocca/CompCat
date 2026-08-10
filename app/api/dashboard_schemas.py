from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.analysis.radius import MAX_ANALYSIS_RADIUS_M, MIN_ANALYSIS_RADIUS_M
from app.crime.sources import LAYER_REPORTED, LAYERS

DashboardRadiusMeters = Annotated[
    int,
    Field(ge=MIN_ANALYSIS_RADIUS_M, le=MAX_ANALYSIS_RADIUS_M),
]

# Every analysis endpoint fans out over radii x date-window, so both are capped: the
# product suggests three radii (config.crime_radii_m), accepts one custom value, and
# ~8 years of window is far past the SPD dataset's useful span. Without these an
# unauthenticated-cheap POST can request an arbitrarily expensive scan.
MAX_ANALYSIS_RADII = 3
MAX_ANALYSIS_SPAN_DAYS = 3000
# Absolute bounds, which the span cap alone does not give: a window can be short and still
# sit at date.max, where exposure.trim_partial_edge_months' `end + timedelta(days=1)`
# raises OverflowError and the request 500s. The floor predates any SPD data; the ceiling
# allows a modest lookahead for windows that run to "today".
MIN_ANALYSIS_DATE = date(2008, 1, 1)
MAX_ANALYSIS_FUTURE_DAYS = 366


def _max_analysis_date() -> date:
    return datetime.now(UTC).date() + timedelta(days=MAX_ANALYSIS_FUTURE_DAYS)


# Offense filters are persisted verbatim onto AnalysisRun, so an unbounded value is a
# multi-MB write per request. 80 matches the /dashboard/trends query cap.
OffenseFilter = Annotated[str | None, Field(default=None, max_length=80)]

# Seattle-metro bounds (lon W/E, lat S/N) — mirrors config.geocoder_viewbox and
# frontend SEATTLE_BBOX. A shared-view point must resolve inside Seattle.
_SEATTLE_WEST, _SEATTLE_EAST = -122.55, -122.10
_SEATTLE_SOUTH, _SEATTLE_NORTH = 47.43, 47.78
# Public aliases so services can clamp to the same bounds without a private-member import.
SEATTLE_WEST, SEATTLE_EAST = _SEATTLE_WEST, _SEATTLE_EAST
SEATTLE_SOUTH, SEATTLE_NORTH = _SEATTLE_SOUTH, _SEATTLE_NORTH
_MAX_POINTS = 10
MAX_AREA_VERTICES = 250
MAX_AREA_FILTER_TYPES = 24
AreaTypeFilter = Annotated[str, Field(min_length=1, max_length=160)]
AreaHourFilter = Annotated[int, Field(ge=0, le=23)]
AreaDayFilter = Annotated[int, Field(ge=0, le=6)]


def _validate_layer(value: str) -> str:
    if value not in LAYERS:
        allowed = ", ".join(sorted(LAYERS))
        raise ValueError(f"layer must be one of: {allowed}")
    return value


class AnalysisPoint(BaseModel):
    latitude: float
    longitude: float
    label: str = Field(min_length=1, max_length=120)
    # Optional report-safe identity for a point that must survive several analysis service
    # calls in one canonical report. Existing callers omit it and retain generated ids.
    selection_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=40,
        pattern=r"^[A-Za-z0-9_-]+$",
        exclude=True,
    )

    @model_validator(mode="after")
    def within_seattle(self) -> AnalysisPoint:
        if not (_SEATTLE_SOUTH <= self.latitude <= _SEATTLE_NORTH
                and _SEATTLE_WEST <= self.longitude <= _SEATTLE_EAST):
            raise ValueError("point is outside the Seattle area")
        return self


class AnalysisWindow(BaseModel):
    """The date window shared by every analysis request, ordered and length-capped."""

    analysis_start_date: date
    analysis_end_date: date

    @model_validator(mode="after")
    def window_must_be_ordered_and_bounded(self) -> AnalysisWindow:
        if self.analysis_end_date < self.analysis_start_date:
            raise ValueError("analysis_end_date must be on or after analysis_start_date")
        latest = _max_analysis_date()
        for value in (self.analysis_start_date, self.analysis_end_date):
            if not MIN_ANALYSIS_DATE <= value <= latest:
                raise ValueError(
                    f"dates must fall between {MIN_ANALYSIS_DATE.isoformat()} and "
                    f"{latest.isoformat()}"
                )
        span_days = (self.analysis_end_date - self.analysis_start_date).days
        if span_days > MAX_ANALYSIS_SPAN_DAYS:
            raise ValueError(
                f"date range is too long — choose a window of at most "
                f"{MAX_ANALYSIS_SPAN_DAYS} days"
            )
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


class DashboardIncidentPointsRequest(AnalysisWindow):
    bounds: MapBounds
    offense_category: OffenseFilter = None
    offense_subcategory: OffenseFilter = None
    nibrs_group: OffenseFilter = None
    layer: str = LAYER_REPORTED

    @field_validator("layer")
    @classmethod
    def layer_must_be_known(cls, value: str) -> str:
        return _validate_layer(value)


class AreaPolygonGeometry(BaseModel):
    """A single-ring GeoJSON polygon produced by rectangle, polygon, or lasso tools."""

    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[tuple[float, float]]]

    @model_validator(mode="after")
    def exterior_ring_is_bounded(self) -> AreaPolygonGeometry:
        if len(self.coordinates) != 1:
            raise ValueError("area selection must contain one exterior ring and no holes")
        ring = self.coordinates[0]
        if not 4 <= len(ring) <= MAX_AREA_VERTICES + 1:
            raise ValueError(
                f"area selection must contain 3 to {MAX_AREA_VERTICES} vertices"
            )
        if ring[0] != ring[-1]:
            raise ValueError("area selection polygon must be closed")
        for longitude, latitude in ring:
            if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                raise ValueError("area selection contains an invalid coordinate")
        return self


class AreaSelectionRequest(AnalysisWindow):
    geometry: AreaPolygonGeometry
    offense_category: OffenseFilter = None
    offense_subcategory: OffenseFilter = None
    nibrs_group: OffenseFilter = None
    # Linked inspector filters. Values within one dimension are ORed; dimensions are ANDed.
    selected_types: list[AreaTypeFilter] = Field(
        default_factory=list,
        max_length=MAX_AREA_FILTER_TYPES,
    )
    selected_hours: list[AreaHourFilter] = Field(default_factory=list, max_length=24)
    selected_days: list[AreaDayFilter] = Field(default_factory=list, max_length=7)
    layer: str = LAYER_REPORTED

    @field_validator("layer")
    @classmethod
    def layer_must_be_known(cls, value: str) -> str:
        return _validate_layer(value)

    @field_validator("selected_types", "selected_hours", "selected_days")
    @classmethod
    def cross_filters_must_be_unique(cls, values: list[object]) -> list[object]:
        if len(values) != len(set(values)):
            raise ValueError("area selection filters must not contain duplicate values")
        return values


class AreaSelectionRecordsRequest(AreaSelectionRequest):
    page_size: int = Field(default=50, ge=1, le=100)
    cursor: str | None = Field(default=None, max_length=512)


class DashboardAnalyzeRequest(AnalysisWindow):
    place_ids: list[str] | None = Field(default=None, min_length=1, max_length=_MAX_POINTS)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=1, max_length=_MAX_POINTS)
    radii_m: list[DashboardRadiusMeters] = Field(min_length=1, max_length=MAX_ANALYSIS_RADII)
    offense_category: OffenseFilter = None
    offense_subcategory: OffenseFilter = None
    nibrs_group: OffenseFilter = None
    # Which incident-context layer to query: "reported" (SPD crime reports), "arrests" (SPD
    # arrest records — enforcement activity, kept separate from reported incidents), or
    # "calls" (911 calls for service). The layers are mutually exclusive by design.
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def exactly_one_selection(self) -> DashboardAnalyzeRequest:
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        point_ids = [point.selection_id for point in self.points or [] if point.selection_id]
        if len(point_ids) != len(set(point_ids)):
            raise ValueError("point selection_id values must be unique")
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


class DashboardCompareRequest(AnalysisWindow):
    place_ids: list[str] | None = Field(default=None, min_length=2, max_length=_MAX_POINTS)
    points: list[AnalysisPoint] | None = Field(default=None, min_length=2, max_length=_MAX_POINTS)
    radius_m: DashboardRadiusMeters
    offense_category: OffenseFilter = None
    offense_subcategory: OffenseFilter = None
    nibrs_group: OffenseFilter = None
    layer: str = LAYER_REPORTED

    @model_validator(mode="after")
    def exactly_one_selection(self) -> DashboardCompareRequest:
        if (self.place_ids is None) == (self.points is None):
            raise ValueError("provide exactly one of place_ids or points")
        point_ids = [point.selection_id for point in self.points or [] if point.selection_id]
        if len(point_ids) != len(set(point_ids)):
            raise ValueError("point selection_id values must be unique")
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
