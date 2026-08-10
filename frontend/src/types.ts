export type Place = {
  id: string;
  display_label: string;
  latitude: number | null;
  longitude: number | null;
  visit_count: number;
  total_dwell_minutes: number | null;
  median_dwell_minutes?: number | null;
  dominant_days?: string | null;
  dominant_hours?: string | null;
  inferred_place_type: string;
  sensitivity_class: string;
};

/** Bounded, transient selection used by shared links and unsaved map pins. */
export type AnalysisPointPayload = {
  latitude: number;
  longitude: number;
  label: string;
};

export type CrimeSummary = {
  place_cluster_id: string;
  radius_m: number;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  incident_count: number;
  nearest_incident_m: number | null;
  incidents_per_visit: number | null;
  incidents_per_hour_dwell: number | null;
  /** Provenance for the persisted aggregate row. Absent only on older API responses. */
  analysis_run_id?: string | null;
  layer?: LayerKey | null;
};

export type PersistedAnalysisScope = {
  run_id: string;
  /** Null means a legacy run predating selected-place provenance. */
  place_ids: string[] | null;
  radii_m: number[] | null;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  layer: LayerKey;
};

export type IncidentDetail = {
  place_id: string;
  place_label: string;
  incident_id: string;
  external_incident_id: string | null;
  report_number: string | null;
  occurred_at: string | null;
  reported_at: string | null;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  block_address: string | null;
  distance_m: number;
};

export type IncidentDetailsResponse = {
  incidents: IncidentDetail[];
  returned_count: number;
  total_count: number;
  limit: number;
  radius_m: number;
};

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type AreaDrawMode = "rectangle" | "polygon" | "lasso";

export type AreaPolygonGeometry = {
  type: "Polygon";
  /** One closed exterior ring in GeoJSON [longitude, latitude] order. */
  coordinates: [[number, number][]];
};

export type AreaSelectionFilters = {
  selectedTypes: string[];
  selectedHours: number[];
  selectedDays: number[];
};

export type AreaHighlightPoint = {
  id: string;
  latitude: number;
  longitude: number;
  record_count: number;
  location_count: number;
};

export type AreaTypeMixRow = { label: string; count: number; share: number };

export type AreaTemporalProfile = {
  hour_counts: number[];
  dow_counts: number[];
  hour_by_dow: number[][];
  total_with_time: number;
  without_time: number;
};

export type AreaSelectionSummary = {
  selection_id: string;
  record_count: number;
  location_count: number;
  counting_basis: string;
  type_mix: AreaTypeMixRow[];
  temporal: AreaTemporalProfile;
  highlight_mode: "locations" | "grid";
  highlight_points: AreaHighlightPoint[];
  highlight_location_count: number;
};

export type AreaSelectionRecord = {
  incident_id: string;
  external_incident_id: string | null;
  report_number: string | null;
  occurred_at: string | null;
  reported_at: string | null;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  block_address: string | null;
  latitude: number;
  longitude: number;
  source_dataset: string;
};

export type AreaSelectionRecordsResponse = {
  selection_id: string;
  records: AreaSelectionRecord[];
  returned_count: number;
  page_size: number;
  next_cursor: string | null;
};

export type IncidentPoint = {
  id: string;
  latitude: number;
  longitude: number;
  /** Number of matching records sharing this block-level coordinate pair. */
  record_count: number;
  offense_category: string | null;
  offense_subcategory: string | null;
  occurred_at: string | null;
  block_address: string | null;
  source_dataset: string;
};

export type IncidentPointsResponse = {
  points: IncidentPoint[];
  /** Matching records represented by the returned location stacks. */
  returned_count: number;
  total_count: number;
  returned_location_count: number;
  total_location_count: number;
  /** Record totals for every layer under the same viewport/date/category filters. */
  layer_totals: Record<LayerKey, number>;
  unmappable_citywide_count: number;
  /** Maximum number of block locations returned, not a raw-record ceiling. */
  limit: number;
};

export type BeatFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { beat: string };
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  }>;
};

export type DashboardSummary = {
  /** The layer the persisted totals were computed for (server always sends it; optional so
   * fixtures predating it still type-check). Absent is treated as "reported". */
  layer?: LayerKey;
  totals: {
    place_count: number;
    visit_count: number;
    incident_count: number;
  };
  privacy: {
    normal: number;
    home_candidate: number;
    work_candidate: number;
    suppressed: number;
  };
  places: Place[];
  crime_summaries: CrimeSummary[];
  analysis: {
    available_radii_m: number[];
    /** Exact metadata for the run that owns crime_summaries. Older servers omit it. */
    persisted_scope?: PersistedAnalysisScope | null;
  };
  exports: {
    tableau_place_summary_csv: string;
    /** Run-scoped analytical detail export. Optional for older servers/fixtures. */
    analysis_csv?: string;
  };
};

export type FreshnessEntry = {
  incident_count: number;
  data_through: string | null;
  earliest: string | null;
  last_ingested_at: string | null;
};

/** Coverage per analysis layer (server returns one entry per layer). */
export type DashboardFreshness = Record<LayerKey, FreshnessEntry>;

export type PlaceCreate = {
  display_label: string;
  latitude: number;
  longitude: number;
  visit_count: number;
  total_dwell_minutes?: number | null;
  median_dwell_minutes?: number | null;
  typical_days?: string | null;
  typical_hours?: string | null;
  sensitivity_class?: string;
};

export type SheetSnap = "bar" | "half" | "full";

export type DrawerState = { collapsed: boolean; widthPx: number; snap: SheetSnap };

export type LatLng = { lat: number; lng: number };

export type DraftPin = {
  latitude: number;
  longitude: number;
  display_label: string;
  visit_count: number;
  sensitivity_class: string;
  source: "map" | "search";
};

export type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
  source: string;
};

/** Which incident-context layer the dashboard queries. "reported" is SPD crime reports;
 * "arrests" is SPD arrest records (enforcement activity); "calls" is 911 calls for service.
 * The three are mutually exclusive. */
export type LayerKey = "reported" | "arrests" | "calls";

export type AnalysisSettings = {
  startDate: string;
  endDate: string;
  radiusM: number;
  offenseCategory: string;
  layer: LayerKey;
};

export type TrendsResponse = {
  layer: LayerKey;
  mcpp: string;
  mcpp_label: string;
  category: string | null;
  months: string[];
  area_counts: number[];
  citywide_counts: number[];
};

// Mirrors the backend `_settings_used` echo (app/assistant/tools.py). The bridge applies only
// fields represented by AnalysisSettings, while cards retain narrower filters for exact
// result explanation and reruns.
export type SettingsUsed = {
  radius_m?: number;
  analysis_start_date?: string;
  analysis_end_date?: string;
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
  layer?: LayerKey;
};

export type ReportLayerProfile = {
  profile_version: string;
  layer: LayerKey;
  report_title: string;
  source_dataset: string;
  counting_unit: string;
  counting_unit_label: string;
  record_noun_singular: string;
  record_noun_plural: string;
  primary_time_field: string;
  primary_time_label: string;
  secondary_time_field: string | null;
  secondary_time_label: string | null;
  subtype_field: string;
  subtype_label: string;
  supported_filters: string[];
  capabilities: {
    reference_context: boolean;
    modeled_comparison: boolean;
    contextual_trend: boolean;
  };
  disclosures: string[];
};

export type ReportFilters = {
  offense_category: string | null;
  offense_subcategory: string | null;
  arrest_offense_description: string | null;
  call_type: string | null;
  nibrs_group: string | null;
};

export type ReportScope = {
  layer: LayerKey;
  source_dataset: string;
  counting_unit: string;
  requested_start_date: string;
  requested_end_date: string;
  effective_start_date: string;
  effective_end_date: string;
  available_start_date: string;
  latest_recorded_event_date: string | null;
  latest_row_ingested_at: string | null;
  confirmed_data_through: string | null;
  radius_m: number;
  filters: ReportFilters;
};

export type ReportSelection = {
  selection_id: string;
  label: string;
  latitude: number;
  longitude: number;
};

export type ReportBreakdownRow = {
  counting_unit: string;
  counting_basis: "per_place_membership";
  label: string;
  count: number;
  share: number;
};

export type ReportTemporalSection = {
  counting_unit: string;
  counting_basis: "per_place_membership";
  hour_counts: number[];
  dow_counts: number[];
  monthly_counts: Record<string, number>;
  with_primary_time: number;
  without_primary_time: number;
};

export type ReportReferenceDistribution = {
  counting_unit: string;
  counting_basis: "per_place_membership";
  kind: string;
  label: string;
  available: boolean;
  adequacy_status: string;
  sampling_frame: string;
  sampling_frame_version: string;
  computation: string | null;
  geography_components: Record<string, unknown>[];
  reference_center_count: number;
  reference_draw_count: number;
  monte_carlo_error: number | null;
  covered_area_share: number;
  effective_geographies: number;
  target_count: number;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  share_below: number | null;
  share_equal: number | null;
  share_above: number | null;
  midrank_percentile: number | null;
  warnings: string[];
};

export type ReportPlaceContext = {
  selection_id: string;
  label: string;
  counting_unit: string;
  counting_basis: "per_place_membership";
  record_count: number;
  type_mix: ReportBreakdownRow[];
  temporal: ReportTemporalSection;
  coordinate_coverage: Record<string, unknown> | null;
  reference_context: ReportReferenceDistribution[];
};

export type ReportComparisonOption = {
  counting_unit: string;
  counting_basis: "per_place_membership";
  selection_id: string;
  label: string;
  record_count: number;
  exposure: number;
  exposure_unit: string;
  record_rate: number;
  rate_ci_lower: number | null;
  rate_ci_upper: number | null;
  rate_ci_method: string | null;
};

export type ReportPairwiseComparison = {
  counting_unit: string;
  counting_basis: "per_place_membership";
  selection_a_id: string;
  selection_a_label: string;
  selection_b_id: string;
  selection_b_label: string;
  decision_class: string;
  method: string;
  record_count_a: number;
  record_count_b: number;
  rate_a: number;
  rate_b: number;
  rate_ratio: number;
  ci_lower: number;
  ci_upper: number;
  p_value: number;
  adjusted_p_value: number;
  overdispersion_phi: number | null;
  overdispersion_status: string;
  minimum_data_status: string;
  caveat_text: string;
};

export type ReportRecord = {
  selection_id: string;
  place_label: string;
  counting_unit: string;
  counting_basis: "per_place_membership";
  source_dataset: string;
  primary_time: string | null;
  secondary_time: string | null;
  offense_category: string | null;
  offense_subcategory: string | null;
  arrest_offense_description: string | null;
  call_type: string | null;
  nibrs_group: string | null;
  distance_m: number;
  duplicate_across_places: boolean;
};

export type AnalysisReport = {
  report_id: string | null;
  schema_version: string;
  method_version: string;
  profile: ReportLayerProfile;
  selection_kind: "single_place" | "multi_place";
  comparison_mode: "none" | "descriptive" | "modeled";
  status: "complete" | "partial" | "insufficient_data";
  generated_at: string;
  scope: ReportScope;
  selection: ReportSelection[];
  sections: {
    overview: {
      counting_unit: string;
      unique_counting_basis: "unique_source_records";
      membership_counting_basis: "per_place_membership";
      unique_source_record_count: number;
      membership_count: number;
      overlap_summary?: {
        shared_source_record_count: number;
        additional_membership_count: number;
        maximum_places_per_record: number;
      } | null;
      returned_record_count: number;
      record_limit: number;
      records_truncated: boolean;
    };
    place_context: ReportPlaceContext[];
    comparison: {
      counting_unit: string;
      counting_basis: "per_place_membership";
      method_family: string;
      decision_class: string;
      summary_text: string;
      caveat_text: string;
      options: ReportComparisonOption[];
      pairwise_results: ReportPairwiseComparison[];
    } | null;
    records: {
      counting_unit: string;
      counting_basis: "per_place_membership";
      total_membership_count: number;
      returned_count: number;
      limit: number;
      truncated: boolean;
      records: ReportRecord[];
    };
  };
  section_statuses: { section: string; state: "complete" | "omitted" | "failed" | "truncated"; reason: string | null }[];
  disclosures: string[];
  export_policy: {
    artifact_coordinate_decimals: 3;
    exact_coordinates_in_artifact: false;
    includes_owner_hash: false;
    includes_internal_place_ids: false;
    persisted_server_side: boolean;
    privacy_policy_checked_at: string;
    download_revalidation: "block_if_saved_place_deleted_or_sensitive";
  };
};

export type AnalysisReportRequest = {
  place_ids?: string[];
  points?: AnalysisPointPayload[];
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category?: string | null;
  offense_subcategory?: string | null;
  arrest_offense_description?: string | null;
  call_type?: string | null;
  nibrs_group?: string | null;
  layer: LayerKey;
  adjust_to_available_dates?: boolean;
  record_limit?: number;
};

/** A frozen snapshot of an assistant-driven analyze/compare run, enough to render the
 * `analysis_card` thread item without touching live dashboard state. */
export type AnalysisCardData = {
  runId: string | null;
  kind: "analyze" | "compare";
  placeIds: string[];
  /** Present for a stateless point-backed run; never implies that the pins were saved. */
  points?: AnalysisPointPayload[];
  settings: SettingsUsed;
  comparison: SiteComparison | null;
  neighborhood: NeighborhoodAnalysis | null;
  incidents: IncidentDetailsResponse | null;
  /** Canonical layer-aware report. New producers always include this; legacy fields above
   * remain only so cards already present during the migration can still render. */
  report?: AnalysisReport;
};

/** A neutral presence descriptor for an analyzed place — server-described, never
 * verdict-bearing (product invariant). Drives the map pin's presence badge. */
export type BadgeDescriptor = {
  place_id: string;
  label: string;
  run_id: string | null;
  settings_fingerprint: string;
};

export type AssistantToolEffect = {
  selection?: { mode: "replace" | "add" | "clear"; ids: string[] };
  settings?: Partial<AnalysisSettings>;
  comparison?: SiteComparison | null;
  neighborhood?: NeighborhoodAnalysis | null;
  incidents?: IncidentDetailsResponse | null;
  refetchSummary?: boolean;
  card?: AnalysisCardData;
  badges?: BadgeDescriptor[];
};

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantDashboardState = {
  selected_place_ids: string[];
  selected_points?: AnalysisPointPayload[];
  analysis_start_date: string | null;
  analysis_end_date: string | null;
  radii_m: number[];
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  layer: LayerKey;
};

/** Minimal, server-recomputable scope for the newest frozen result card. */
export type AssistantResultContext = {
  kind: "analyze" | "compare";
  place_ids: string[];
  points?: AnalysisPointPayload[];
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  layer: LayerKey;
};

export type AssistantStreamEvent =
  | { event: "meta"; data: Record<string, unknown> }
  | { event: "tool"; data: { tool_name?: string; result?: unknown; [key: string]: unknown } }
  | { event: "token"; data: { delta?: string } }
  | { event: "status"; data: { label?: string } }
  | { event: "replace"; data: { text?: string } }
  | { event: "done"; data: Record<string, unknown> }
  | { event: "error"; data: { message?: string; code?: string } };

export type TemporalProfile = {
  hour_counts: number[]; // length 24, local hour 0–23
  dow_counts: number[]; // length 7, Mon..Sun
  hour_by_dow: number[][]; // 7×24 joint counts
  total_with_time: number;
  without_time: number;
};

export type CategoryShare = { label: string; place_count: number; place_share: number; beat_share: number | null };

export type BaselineEntry = {
  kind: "mcpp" | "beat" | "sector" | "city";
  label: string;
  area_km2: number;
  baseline_incident_count: number;
  baseline_rate: number;
  rate_ratio: number;
  ci_lower: number;
  ci_upper: number;
  adjusted_p_value: number;
  method: string;
  relation: "above" | "similar" | "below" | "insufficient";
};

export type ReferenceGeographyComponent = {
  id: string;
  label: string;
  weight: number;
  center_count: number;
};

export type ReferenceCircleComparison = {
  kind: "mcpp" | "sector" | "city";
  label: string;
  available: boolean;
  adequacy_status:
    | "met"
    | "no_reference_geography"
    | "missing_reference_centers"
    | "insufficient_reference_centers"
    | "insufficient_polygon_coverage";
  sampling_frame: "street_segment_midpoints";
  sampling_frame_version: string;
  computation: "exact" | "monte_carlo" | null;
  geography_components: ReferenceGeographyComponent[];
  reference_center_count: number;
  reference_draw_count: number;
  monte_carlo_error: number | null;
  covered_area_share: number;
  effective_geographies: number;
  target_count: number;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  share_below: number | null;
  share_equal: number | null;
  share_above: number | null;
  midrank_percentile: number | null;
  warnings: string[];
};

export type NeighborhoodPlace = {
  place_id: string;
  place_label: string;
  beat: string | null;
  baseline_beats?: string[] | null;
  radius_m: number;
  baseline_available: boolean;
  decision: "above_clear" | "below_clear" | "not_clear" | "insufficient_data" | "model_warning" | "baseline_unavailable";
  place_incident_count: number;
  place_rate?: number;
  minimum_data_status?: string;
  nearest_incident_m?: number | null;
  monthly_counts?: number[];
  category_breakdown: CategoryShare[];
  temporal?: TemporalProfile | null;
  baselines: BaselineEntry[];
  /** Empirical equal-radius context. Optional while older frozen cards remain readable. */
  reference_comparisons?: ReferenceCircleComparison[];
  place_rate_ci_lower?: number;
  place_rate_ci_upper?: number;
  coordinate_coverage?: {
    total: number;
    with_coordinates: number;
    area_kind: "mcpp" | "beat";
  } | null;
};

export type NeighborhoodPair = {
  a_place_id: string; a_label: string; b_place_id: string; b_label: string;
  rate_ratio: number; ci_lower: number; ci_upper: number; adjusted_p_value: number;
};

export type NeighborhoodAnalysis = {
  radius_m: number;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category: string | null;
  places: NeighborhoodPlace[];
  pairwise: NeighborhoodPair[];
};

export type SiteDecisionClass =
  | "statistically_lower"
  | "not_statistically_clear"
  | "insufficient_data"
  | "model_warning";

export type SiteComparisonOption = {
  id: string;
  label: string;
  geometry_type: string;
  radius_m: number;
  incident_count: number;
  exposure: number;
  exposure_unit: string;
  incident_rate: number;
  rate_ci_lower?: number | null;
  rate_ci_upper?: number | null;
  rate_ci_method?: string | null;
};

export type SitePairwiseResult = {
  id: string;
  option_a_id: string;
  option_a_label: string;
  option_b_id: string;
  option_b_label: string;
  winner_option_id: string | null;
  winner_label: string | null;
  decision_class: SiteDecisionClass;
  method: string;
  incident_count_a: number;
  incident_count_b: number;
  exposure_a: number;
  exposure_b: number;
  exposure_unit: string;
  rate_a: number;
  rate_b: number;
  rate_ratio: number;
  ci_lower: number;
  ci_upper: number;
  p_value: number;
  adjusted_p_value: number;
  overdispersion_phi: number | null;
  overdispersion_status: string;
  minimum_data_status: string;
  caveat_text: string;
};

export type SiteComparisonOverview = {
  label: string;
  decision_class: SiteDecisionClass;
  recommendation_option_id: string | null;
  recommendation_label: string | null;
  summary_text: string;
  caveat_text: string;
  options: SiteComparisonOption[];
};

export type SiteComparisonAnalytical = {
  label: string;
  source_dataset: string;
  exposure_unit: string;
  full_caveat_text: string;
  options: SiteComparisonOption[];
  pairwise_results: SitePairwiseResult[];
};

export type SiteComparison = {
  id: string;
  comparison_type: string;
  geometry_type: string;
  radius_m: number;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  created_at: string;
  overview: SiteComparisonOverview;
  analytical: SiteComparisonAnalytical;
};
