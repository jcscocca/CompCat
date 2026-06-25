import type {
  AssistantDashboardState,
  AssistantMessage,
  AssistantStreamEvent,
  DashboardSummary,
  IncidentDetailsResponse,
  Place,
  PlaceCreate,
} from "../types";

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

type IncidentDetailsPayload = AnalyzePlacesPayload & {
  limit?: number;
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

export function getIncidentDetails(
  payload: IncidentDetailsPayload,
): Promise<IncidentDetailsResponse> {
  return request("/dashboard/incidents", {
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
  const data = dataLines.length ? JSON.parse(dataLines.join("\n")) : {};
  onEvent({ event: eventName, data } as AssistantStreamEvent);
}
