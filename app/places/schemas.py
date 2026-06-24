from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

SensitivityClass = Literal[
    "normal",
    "home_candidate",
    "work_candidate",
    "health_candidate",
    "religious_candidate",
    "suppress_from_public_export",
]


class ManualPlaceCreate(BaseModel):
    display_label: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    visit_count: int = Field(default=1, ge=1, le=10000)
    total_dwell_minutes: float | None = Field(default=None, ge=0, le=1_000_000)
    median_dwell_minutes: float | None = Field(default=None, ge=0, le=100_000)
    typical_days: str | None = Field(default=None, max_length=120)
    typical_hours: str | None = Field(default=None, max_length=120)
    sensitivity_class: SensitivityClass = "normal"

    @field_validator("display_label")
    @classmethod
    def display_label_must_not_be_blank(cls, value: str) -> str:
        return _strip_non_empty_label(value)


class ManualPlaceUpdate(BaseModel):
    display_label: str | None = Field(default=None, min_length=1, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    visit_count: int | None = Field(default=None, ge=1, le=10000)
    total_dwell_minutes: float | None = Field(default=None, ge=0, le=1_000_000)
    median_dwell_minutes: float | None = Field(default=None, ge=0, le=100_000)
    typical_days: str | None = Field(default=None, max_length=120)
    typical_hours: str | None = Field(default=None, max_length=120)
    sensitivity_class: SensitivityClass | None = None

    @field_validator("display_label")
    @classmethod
    def display_label_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _strip_non_empty_label(value)


class ManualPlaceResponse(BaseModel):
    id: str
    display_label: str
    latitude: float | None
    longitude: float | None
    visit_count: int
    total_dwell_minutes: float | None
    median_dwell_minutes: float | None
    typical_days: str | None
    typical_hours: str | None
    inferred_place_type: str
    sensitivity_class: SensitivityClass


class BulkPlaceCreate(BaseModel):
    csv_text: str = Field(min_length=1, max_length=200_000)


class BulkPlaceCreateResponse(BaseModel):
    created_count: int
    skipped_count: int
    places: list[ManualPlaceResponse]


def _strip_non_empty_label(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("display_label must not be blank")
    return stripped
