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
  };
  exports: {
    tableau_place_summary_csv: string;
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

export type TabKey = "places" | "analyze" | "compare" | "export";

export type DrawerState = { collapsed: boolean; widthPx: number };

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

export type AssistantToolEffect = {
  selection?: { mode: "replace" | "add" | "clear"; ids: string[] };
  settings?: Partial<AnalysisSettings>;
  comparison?: Record<string, unknown> | null;
  neighborhood?: NeighborhoodAnalysis | null;
  incidents?: IncidentDetailsResponse | null;
  refetchSummary?: boolean;
  tab?: TabKey;
};

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantDashboardState = {
  selected_place_ids: string[];
  analysis_start_date: string | null;
  analysis_end_date: string | null;
  radii_m: number[];
  offense_category: string | null;
  offense_subcategory: string | null;
  nibrs_group: string | null;
  layer: LayerKey;
};

export type AssistantStreamEvent =
  | { event: "meta"; data: Record<string, unknown> }
  | { event: "tool"; data: { tool_name?: string; result?: unknown; [key: string]: unknown } }
  | { event: "token"; data: { delta?: string } }
  | { event: "done"; data: Record<string, unknown> }
  | { event: "error"; data: { message?: string } };

export type TemporalProfile = {
  hour_counts: number[]; // length 24, local hour 0–23
  dow_counts: number[]; // length 7, Mon..Sun
  hour_by_dow: number[][]; // 7×24 joint counts
  total_with_time: number;
  without_time: number;
};

export type CategoryShare = { label: string; place_count: number; place_share: number; beat_share: number | null };

export type NeighborhoodPlace = {
  place_id: string;
  place_label: string;
  beat: string | null;
  radius_m: number;
  baseline_available: boolean;
  decision: "above_clear" | "below_clear" | "not_clear" | "insufficient_data" | "model_warning" | "baseline_unavailable";
  place_incident_count: number;
  beat_incident_count?: number;
  place_rate?: number;
  beat_rate?: number;
  rate_ratio?: number;
  ci_lower?: number;
  ci_upper?: number;
  adjusted_p_value?: number;
  exact_p_value?: number | null;
  method?: string;
  overdispersion_status?: string;
  minimum_data_status?: string;
  nearest_incident_m?: number | null;
  monthly_counts?: number[];
  category_breakdown: CategoryShare[];
  temporal?: TemporalProfile | null;
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
