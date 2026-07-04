from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.schemas import new_id


def utc_now() -> datetime:
    return datetime.now(UTC)


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    source_type: Mapped[str] = mapped_column(Text)
    original_filename: Mapped[str] = mapped_column(Text)
    file_hash_sha256: Mapped[str] = mapped_column(Text)
    parser_version: Mapped[str] = mapped_column(Text)
    detected_schema: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    min_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(Text, default="parsed")
    raw_retention_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    privacy_mode: Mapped[str] = mapped_column(Text, default="tableau_safe")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class StagingLocationObservation(Base):
    __tablename__ = "staging_location_observations"
    __table_args__ = (UniqueConstraint("import_id", "source_record_hash", name="uq_staging_hash"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    import_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), index=True)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    source_record_type: Mapped[str] = mapped_column(Text)
    source_record_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    observed_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    display_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class StopVisit(Base):
    __tablename__ = "stop_visits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    import_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), index=True)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    place_cluster_id: Mapped[str | None] = mapped_column(
        ForeignKey("place_clusters.id"),
        nullable=True,
        index=True,
    )
    start_time_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[float] = mapped_column(Float)
    local_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    local_day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    local_hour_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    centroid_latitude: Mapped[float] = mapped_column(Float)
    centroid_longitude: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_median_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_basis: Mapped[str] = mapped_column(Text)
    point_count_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    display_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PlaceCluster(Base):
    __tablename__ = "place_clusters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    cluster_version: Mapped[str] = mapped_column(Text)
    cluster_method: Mapped[str] = mapped_column(Text)
    centroid_latitude: Mapped[float] = mapped_column(Float)
    centroid_longitude: Mapped[float] = mapped_column(Float)
    display_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    display_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    cluster_radius_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    visit_count: Mapped[int] = mapped_column(Integer)
    total_dwell_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_dwell_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    first_seen_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dominant_days: Mapped[str | None] = mapped_column(Text, nullable=True)
    dominant_hours: Mapped[str | None] = mapped_column(Text, nullable=True)
    inferred_place_type: Mapped[str] = mapped_column(Text, default="unknown")
    sensitivity_class: Mapped[str] = mapped_column(Text, default="normal")
    display_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    label_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class CrimeIncident(Base):
    __tablename__ = "crime_incidents"
    __table_args__ = (
        UniqueConstraint(
            "source_dataset", "external_incident_id", name="uq_crime_source_external_id"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    external_incident_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_start_utc: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    offense_end_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    report_utc: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    offense_category: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    offense_subcategory: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    nibrs_group: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    precinct: Mapped[str | None] = mapped_column(Text, nullable=True)
    sector: Mapped[str | None] = mapped_column(Text, nullable=True)
    beat: Mapped[str | None] = mapped_column(Text, nullable=True)
    mcpp: Mapped[str | None] = mapped_column(Text, nullable=True)
    block_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    source_dataset: Mapped[str] = mapped_column(Text, default="seattle_spd_crime", index=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PlaceCrimeSummary(Base):
    __tablename__ = "place_crime_summaries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    place_cluster_id: Mapped[str] = mapped_column(ForeignKey("place_clusters.id"), index=True)
    radius_m: Mapped[int] = mapped_column(Integer)
    analysis_start_date: Mapped[date] = mapped_column(Date)
    analysis_end_date: Mapped[date] = mapped_column(Date)
    offense_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_subcategory: Mapped[str | None] = mapped_column(Text, nullable=True)
    nibrs_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    incident_count: Mapped[int] = mapped_column(Integer)
    nearest_incident_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    incidents_per_visit: Mapped[float | None] = mapped_column(Float, nullable=True)
    incidents_per_hour_dwell: Mapped[float | None] = mapped_column(Float, nullable=True)
    analysis_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    # Which analysis layer produced this summary ("reported" or "calls"); null = legacy
    # rows, treated as "reported" on read.
    layer: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    analysis_start_date: Mapped[date] = mapped_column(Date)
    analysis_end_date: Mapped[date] = mapped_column(Date)
    radii_m_json: Mapped[str] = mapped_column(Text)
    offense_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_subcategory: Mapped[str | None] = mapped_column(Text, nullable=True)
    nibrs_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    layer: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class StatisticalComparison(Base):
    __tablename__ = "statistical_comparisons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    comparison_type: Mapped[str] = mapped_column(Text)
    geometry_type: Mapped[str] = mapped_column(Text)
    radius_m: Mapped[int] = mapped_column(Integer)
    analysis_start_date: Mapped[date] = mapped_column(Date)
    analysis_end_date: Mapped[date] = mapped_column(Date)
    offense_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    offense_subcategory: Mapped[str | None] = mapped_column(Text, nullable=True)
    nibrs_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_dataset: Mapped[str] = mapped_column(Text, default="seattle_spd_crime")
    exposure_unit: Mapped[str] = mapped_column(Text, default="square_km_days")
    decision_class: Mapped[str] = mapped_column(Text)
    recommendation_option_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    overview_summary_text: Mapped[str] = mapped_column(Text)
    overview_caveat_text: Mapped[str] = mapped_column(Text)
    full_caveat_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class StatisticalComparisonOption(Base):
    __tablename__ = "statistical_comparison_options"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    comparison_id: Mapped[str] = mapped_column(
        ForeignKey("statistical_comparisons.id"),
        index=True,
    )
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    option_id: Mapped[str] = mapped_column(Text)
    option_label: Mapped[str] = mapped_column(Text)
    geometry_type: Mapped[str] = mapped_column(Text)
    radius_m: Mapped[int] = mapped_column(Integer)
    incident_count: Mapped[int] = mapped_column(Integer)
    exposure: Mapped[float] = mapped_column(Float)
    exposure_unit: Mapped[str] = mapped_column(Text)
    incident_rate: Mapped[float] = mapped_column(Float)
    rate_ci_lower: Mapped[float | None] = mapped_column(Float, nullable=True)
    rate_ci_upper: Mapped[float | None] = mapped_column(Float, nullable=True)
    rate_ci_method: Mapped[str | None] = mapped_column(Text, nullable=True)
    geometry_metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class StatisticalPairwiseResult(Base):
    __tablename__ = "statistical_pairwise_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    comparison_id: Mapped[str] = mapped_column(
        ForeignKey("statistical_comparisons.id"),
        index=True,
    )
    user_id_hash: Mapped[str] = mapped_column(Text, index=True)
    option_a_id: Mapped[str] = mapped_column(Text)
    option_a_label: Mapped[str] = mapped_column(Text)
    option_b_id: Mapped[str] = mapped_column(Text)
    option_b_label: Mapped[str] = mapped_column(Text)
    winner_option_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    winner_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_class: Mapped[str] = mapped_column(Text)
    method: Mapped[str] = mapped_column(Text)
    incident_count_a: Mapped[int] = mapped_column(Integer)
    incident_count_b: Mapped[int] = mapped_column(Integer)
    exposure_a: Mapped[float] = mapped_column(Float)
    exposure_b: Mapped[float] = mapped_column(Float)
    exposure_unit: Mapped[str] = mapped_column(Text)
    rate_a: Mapped[float] = mapped_column(Float)
    rate_b: Mapped[float] = mapped_column(Float)
    rate_ratio: Mapped[float] = mapped_column(Float)
    ci_lower: Mapped[float] = mapped_column(Float)
    ci_upper: Mapped[float] = mapped_column(Float)
    p_value: Mapped[float] = mapped_column(Float)
    adjusted_p_value: Mapped[float] = mapped_column(Float)
    overdispersion_phi: Mapped[float | None] = mapped_column(Float, nullable=True)
    overdispersion_status: Mapped[str] = mapped_column(Text)
    minimum_data_status: Mapped[str] = mapped_column(Text)
    caveat_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class GeocodeCache(Base):
    __tablename__ = "geocode_cache"
    __table_args__ = (
        UniqueConstraint(
            "provider", "query_normalized", name="uq_geocode_cache_provider_query"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(Text)
    query_normalized: Mapped[str] = mapped_column(Text)
    results_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
