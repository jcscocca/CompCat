import type {
  AssistantDashboardState,
  AssistantMessage,
  AssistantStreamEvent,
  BeatFeatureCollection,
  DashboardFreshness,
  DashboardSummary,
  IncidentDetailsResponse,
  IncidentPointsResponse,
  MapBounds,
  NeighborhoodAnalysis,
  Place,
  PlaceCreate,
  SiteComparison,
} from "../types";

type AnalysisPointPayload = { latitude: number; longitude: number; label: string };

type AnalyzePlacesPayload = {
  place_ids?: string[];
  points?: AnalysisPointPayload[];
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
  layer?: string;
};

type ComparePlacesPayload = {
  place_ids?: string[];
  points?: AnalysisPointPayload[];
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category?: string | null;
  offense_subcategory?: string | null;
  nibrs_group?: string | null;
  layer?: string;
};

type IncidentDetailsPayload = AnalyzePlacesPayload & {
  limit?: number;
};

export type IncidentPointsPayload = {
  bounds: MapBounds;
  analysis_start_date: string;
  analysis_end_date: string;
  offense_category?: string | null;
  layer?: string;
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

export function getDashboardFreshness(): Promise<DashboardFreshness> {
  return request("/dashboard/freshness");
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

export async function uploadPersonalData(file: File): Promise<{ place_cluster_count: number }> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/uploads", { method: "POST", credentials: "include", body });
  if (!response.ok) {
    throw new Error((await response.text()) || `Upload failed (${response.status})`);
  }
  return response.json();
}

export function deletePersonalData(): Promise<{ place_clusters: number }> {
  return request("/uploads", { method: "DELETE" });
}

export function getInputModes(): Promise<{ modes: { id: string }[] }> {
  return request("/input-modes");
}

export function analyzePlaces(
  payload: AnalyzePlacesPayload,
): Promise<{ summary_count: number }> {
  return request("/dashboard/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getIncidentDetails(
  payload: IncidentDetailsPayload,
): Promise<IncidentDetailsResponse> {
  return request("/dashboard/incidents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getBeatPolygons(): Promise<BeatFeatureCollection> {
  return request<BeatFeatureCollection>("/dashboard/beats");
}

export function getIncidentPoints(
  payload: IncidentPointsPayload,
  signal?: AbortSignal,
): Promise<IncidentPointsResponse> {
  return request<IncidentPointsResponse>("/dashboard/incident-points", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function comparePlaces(
  payload: ComparePlacesPayload,
): Promise<SiteComparison> {
  return request("/dashboard/compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getNeighborhoodAnalysis(
  payload: AnalyzePlacesPayload,
): Promise<NeighborhoodAnalysis> {
  return request("/dashboard/neighborhood", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

type AssistantHandlers = {
  onEvent: (event: AssistantStreamEvent) => void;
};

export async function streamAssistantChat(
  payload: {
    messages: AssistantMessage[];
    dashboard_state: AssistantDashboardState;
  },
  handlers: AssistantHandlers,
): Promise<void> {
  const response = await fetch("/assistant/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Assistant response did not include a stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = flushAssistantEvents(buffer, handlers.onEvent);
  }
  buffer += decoder.decode();
  flushAssistantEvents(buffer, handlers.onEvent, true);
}

function flushAssistantEvents(
  buffer: string,
  onEvent: (event: AssistantStreamEvent) => void,
  flushAll = false,
): string {
  let cursor = buffer.indexOf("\n\n");
  while (cursor >= 0) {
    emitAssistantEvent(buffer.slice(0, cursor), onEvent);
    buffer = buffer.slice(cursor + 2);
    cursor = buffer.indexOf("\n\n");
  }
  if (flushAll && buffer.trim()) {
    emitAssistantEvent(buffer, onEvent);
    return "";
  }
  return buffer;
}

function emitAssistantEvent(block: string, onEvent: (event: AssistantStreamEvent) => void) {
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!eventName) return;
  let data: unknown = {};
  if (dataLines.length) {
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      // Skip a malformed token frame rather than aborting the rest of the stream, but
      // never drop a terminal frame: surface error/done with empty data so the user is
      // not left with neither an answer nor an error.
      if (eventName !== "error" && eventName !== "done") return;
    }
  }
  onEvent({ event: eventName, data } as AssistantStreamEvent);
}
