import type { DashboardSummary, Place, PlaceCreate } from "../types";

type AnalyzePlacesPayload = {
  place_ids: string[];
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
};

type ComparePlacesPayload = {
  place_ids: string[];
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function createSession(): Promise<{ session_state: string }> {
  return request("/sessions", { method: "POST" });
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return request("/dashboard/summary");
}

export function createPlace(payload: PlaceCreate): Promise<Place> {
  return request("/places", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createBulkPlaces(
  csvText: string,
): Promise<{ created_count: number; skipped_count: number; places: Place[] }> {
  return request("/places/bulk", {
    method: "POST",
    body: JSON.stringify({ csv_text: csvText }),
  });
}

export function deletePlace(placeId: string): Promise<void> {
  return request(`/places/${placeId}`, { method: "DELETE" });
}

export function analyzePlaces(
  payload: AnalyzePlacesPayload,
): Promise<{ summary_count: number }> {
  return request("/dashboard/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function comparePlaces(
  payload: ComparePlacesPayload,
): Promise<Record<string, unknown>> {
  return request("/dashboard/compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
