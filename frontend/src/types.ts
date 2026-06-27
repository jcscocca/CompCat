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
  source: "map" | "search";
};

export type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
  source: string;
};

export type AnalysisSettings = {
  startDate: string;
  endDate: string;
  radiusM: number;
  offenseCategory: string;
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
};

export type AssistantStreamEvent =
  | { event: "meta"; data: Record<string, unknown> }
  | { event: "tool"; data: { tool_name?: string; result?: unknown; [key: string]: unknown } }
  | { event: "token"; data: { delta?: string } }
  | { event: "done"; data: Record<string, unknown> }
  | { event: "error"; data: { message?: string } };

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
  type_mix: { label: string; count: number }[];
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
