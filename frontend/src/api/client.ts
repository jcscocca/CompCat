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
  McppFeatureCollection,
  NeighborhoodAnalysis,
  Place,
  PlaceCreate,
  SiteComparison,
  TrendsResponse,
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

/**
 * Status→copy mapping for every failing HTTP call. A raw response body (FastAPI's
 * `{"detail": …}`, a reverse proxy's HTML error page, a stack trace) must never become a
 * thrown Error.message: components render those messages, so the body would reach the
 * screen. Bodies go to console.debug instead, which keeps them debuggable in devtools.
 */
export const SESSION_EXPIRED_MESSAGE = "Session expired — reload to start a new one.";
/** Matches the wording the rate limiter itself uses (app/ratelimit.py). */
export const RATE_LIMITED_MESSAGE = "Request limit reached — please retry shortly.";
export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Try again shortly.";
export const GENERIC_ERROR_MESSAGE = "That request didn't go through. Try again.";

export function friendlyRequestError(status: number): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  if (status >= 500) return SERVER_ERROR_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
}

const FRIENDLY_MESSAGES: ReadonlySet<string> = new Set([
  SESSION_EXPIRED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SERVER_ERROR_MESSAGE,
  GENERIC_ERROR_MESSAGE,
]);

/**
 * True when a rejection carries one of the messages above — i.e. it came from `request`
 * and is safe to render. Anything else (a TypeError, a parse failure) must not reach the
 * screen, which is why callers pass their own fallback rather than printing `error.message`.
 */
export function isFriendlyRequestError(error: unknown): error is Error {
  return error instanceof Error && FRIENDLY_MESSAGES.has(error.message);
}

/** The status-mapped message when there is one, else the caller's generic copy. */
export function friendlyMessageOr(error: unknown, fallback: string): string {
  return isFriendlyRequestError(error) ? error.message : fallback;
}

/** A 401: the session is gone, so retrying the same call cannot help — only a reload can. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof Error && error.message === SESSION_EXPIRED_MESSAGE;
}

function isAbort(cause: unknown): boolean {
  return (cause as { name?: string } | null)?.name === "AbortError";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> | undefined),
      },
    });
  } catch (cause) {
    // A cancelled request is control flow, not a failure: callers check signal.aborted.
    if (isAbort(cause)) throw cause;
    console.debug("request network failure", path, cause);
    throw new Error(SERVER_ERROR_MESSAGE);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.debug("request failed", path, response.status, body);
    throw new Error(friendlyRequestError(response.status));
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

export function updatePlace(placeId: string, payload: { display_label?: string; sensitivity_class?: string }): Promise<Place> {
  return request(`/places/${placeId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function uploadPersonalData(file: File): Promise<{ place_cluster_count: number }> {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch("/uploads", { method: "POST", credentials: "include", body });
  } catch (cause) {
    if (isAbort(cause)) throw cause;
    console.debug("upload network failure", cause);
    throw new Error(SERVER_ERROR_MESSAGE);
  }
  if (!response.ok) {
    console.debug("upload failed", response.status, await response.text().catch(() => ""));
    throw new Error(friendlyRequestError(response.status));
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

export function getMcppPolygons(): Promise<McppFeatureCollection> {
  return request<McppFeatureCollection>("/dashboard/mcpp");
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

export function getTrends(
  params: { mcpp: string; layer: string; category?: string | null },
  signal?: AbortSignal,
): Promise<TrendsResponse> {
  const search = new URLSearchParams({ mcpp: params.mcpp, layer: params.layer });
  if (params.category) search.set("category", params.category);
  return request<TrendsResponse>(`/dashboard/trends?${search.toString()}`, { signal });
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

async function streamAssistantSse(
  path: string,
  payload: unknown,
  handlers: AssistantHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    console.debug("assistant stream failed", response.status, await response.text());
    throw new Error(friendlyRequestError(response.status));
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

export function streamAssistantChat(
  payload: {
    messages: AssistantMessage[];
    dashboard_state: AssistantDashboardState;
  },
  handlers: AssistantHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamAssistantSse("/assistant/chat", payload, handlers, signal);
}

export type AssistantCommandName =
  | "analyze_places"
  | "compare_places"
  | "add_place"
  | "select_places"
  | "update_filters"
  | "suggest_followups";

export function streamAssistantCommand(
  payload: { command: AssistantCommandName; arguments?: Record<string, unknown> },
  handlers: AssistantHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamAssistantSse("/assistant/commands", payload, handlers, signal);
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
