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
