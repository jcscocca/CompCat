import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createSession,
  friendlyMessageOr,
  getDashboardFreshness,
  getDashboardSummary,
  getInputModes,
} from "../api/client";
import type { DashboardFreshness, DashboardSummary, Place } from "../types";

const DEFAULT_EXPORT = "/exports/tableau/place-summary.csv";
const DEFAULT_ANALYSIS_EXPORT = "/exports/analysis.csv";

export interface DashboardData {
  sessionReady: boolean;
  summary: DashboardSummary | null;
  freshness: DashboardFreshness | null;
  freshnessLoaded: boolean;
  personalUploadsEnabled: boolean;
  error: string;
  /** The session bootstrap itself failed — nothing else can load, so offer a retry. */
  sessionFailed: boolean;
  retryBootstrap: () => void;
  setError: (message: string) => void;
  refresh: () => Promise<void>;
  refreshWithFallback: (fallbackMessage: string) => Promise<void>;
  places: Place[];
  availableRadii: number[];
  exportHref: string;
  analysisExportHref: string;
}

/**
 * Owns the core dashboard data layer: bootstraps the session, loads the dashboard
 * summary, the crime-data freshness window, and the available input modes, and exposes
 * the `refresh`/`refreshWithFallback` helpers plus the derived places/radii/export-href
 * the rest of the workspace reads.
 */
export function useDashboardData(): DashboardData {
  const [sessionReady, setSessionReady] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [freshness, setFreshness] = useState<DashboardFreshness | null>(null);
  const [freshnessLoaded, setFreshnessLoaded] = useState(false);
  const [personalUploadsEnabled, setPersonalUploadsEnabled] = useState(false);
  const [error, setError] = useState("");
  const [sessionFailed, setSessionFailed] = useState(false);
  // Bumping this re-runs the bootstrap effect, which is the whole of "Retry".
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  const refresh = async () => {
    setSummary(await getDashboardSummary());
  };
  const refreshWithFallback = async (fallbackMessage: string) => {
    try {
      await refresh();
    } catch (cause) {
      // A 401/429/5xx already has copy that says what actually happened; the caller's
      // fallback is only for the cases we can't name.
      setError(friendlyMessageOr(cause, fallbackMessage));
    }
  };

  const retryBootstrap = useCallback(() => setBootstrapAttempt((n) => n + 1), []);

  useEffect(() => {
    let isMounted = true;
    setError("");
    setSessionFailed(false);
    createSession()
      .then(() => {
        if (!isMounted) return;
        setSessionReady(true);
        void getDashboardSummary()
          .then((value) => {
            if (!isMounted) return;
            setError("");
            setSummary(value);
          })
          .catch((cause) => {
            if (isMounted) setError(friendlyMessageOr(cause, "Unable to load dashboard data. Try again shortly."));
          });
        void getDashboardFreshness()
          .then((value) => {
            if (isMounted) setFreshness(value);
          })
          .catch(() => {
            if (isMounted) setFreshness(null);
          })
          .finally(() => {
            if (isMounted) setFreshnessLoaded(true);
          });
      })
      .catch((cause) => {
        if (isMounted) {
          setFreshnessLoaded(true);
          setSessionFailed(true);
          setError(friendlyMessageOr(cause, "Unable to start a dashboard session. Try again shortly."));
        }
      });
    return () => {
      isMounted = false;
    };
  }, [bootstrapAttempt]);

  useEffect(() => {
    let active = true;
    getInputModes()
      .then((data) => {
        if (active) setPersonalUploadsEnabled(data.modes.some((mode) => mode.id === "personal_timeline"));
      })
      .catch(() => {
        if (active) setPersonalUploadsEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const places: Place[] = useMemo(() => summary?.places ?? [], [summary]);
  const availableRadii = summary?.analysis.available_radii_m ?? [];
  const exportHref = summary?.exports.tableau_place_summary_csv || DEFAULT_EXPORT;
  const analysisExportHref = summary?.exports.analysis_csv || DEFAULT_ANALYSIS_EXPORT;

  return {
    sessionReady,
    summary,
    freshness,
    freshnessLoaded,
    personalUploadsEnabled,
    error,
    sessionFailed,
    retryBootstrap,
    setError,
    refresh,
    refreshWithFallback,
    places,
    availableRadii,
    exportHref,
    analysisExportHref,
  };
}
