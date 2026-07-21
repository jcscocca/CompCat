import { useEffect, useMemo, useState } from "react";

import {
  createSession,
  getDashboardFreshness,
  getDashboardSummary,
  getInputModes,
} from "../api/client";
import type { DashboardFreshness, DashboardSummary, Place } from "../types";

const DEFAULT_EXPORT = "/exports/tableau/place-summary.csv";

export interface DashboardData {
  summary: DashboardSummary | null;
  freshness: DashboardFreshness | null;
  freshnessLoaded: boolean;
  personalUploadsEnabled: boolean;
  error: string;
  setError: (message: string) => void;
  refresh: () => Promise<void>;
  refreshWithFallback: (fallbackMessage: string) => Promise<void>;
  places: Place[];
  availableRadii: number[];
  exportHref: string;
}

/**
 * Owns the core dashboard data layer: bootstraps the session, loads the dashboard
 * summary, the crime-data freshness window, and the available input modes, and exposes
 * the `refresh`/`refreshWithFallback` helpers plus the derived places/radii/export-href
 * the rest of the workspace reads.
 */
export function useDashboardData(): DashboardData {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [freshness, setFreshness] = useState<DashboardFreshness | null>(null);
  const [freshnessLoaded, setFreshnessLoaded] = useState(false);
  const [personalUploadsEnabled, setPersonalUploadsEnabled] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setSummary(await getDashboardSummary());
  };
  const refreshWithFallback = async (fallbackMessage: string) => {
    try {
      await refresh();
    } catch {
      setError(fallbackMessage);
    }
  };

  useEffect(() => {
    let isMounted = true;
    setError("");
    createSession()
      .then(() => getDashboardSummary())
      .then((next) => {
        if (isMounted) {
          setError("");
          setSummary(next);
        }
      })
      .catch(() => {
        if (isMounted) setError("Unable to start a dashboard session. Try again shortly.");
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getDashboardFreshness()
      .then((data) => {
        if (active) {
          setFreshness(data);
          setFreshnessLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setFreshness(null);
          setFreshnessLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

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

  return {
    summary,
    freshness,
    freshnessLoaded,
    personalUploadsEnabled,
    error,
    setError,
    refresh,
    refreshWithFallback,
    places,
    availableRadii,
    exportHref,
  };
}
