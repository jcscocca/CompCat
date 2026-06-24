import { ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  analyzePlaces,
  comparePlaces,
  createBulkPlaces,
  createPlace,
  createSession,
  deletePlace,
  getDashboardSummary,
} from "./api/client";
import { AnalysisControls } from "./components/AnalysisControls";
import { BulkPlaceEntry } from "./components/BulkPlaceEntry";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { ExportPanel } from "./components/ExportPanel";
import { Notice } from "./components/Notice";
import { PlaceForm } from "./components/PlaceForm";
import { PlaceTable } from "./components/PlaceTable";
import { ResultsSummary } from "./components/ResultsSummary";
import type { DashboardSummary, Place, PlaceCreate } from "./types";

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const comparisonVersionRef = useRef(0);

  const refresh = async () => {
    const nextSummary = await getDashboardSummary();
    setSummary(nextSummary);
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
      .then((nextSummary) => {
        if (isMounted) {
          setError("");
          setSummary(nextSummary);
        }
      })
      .catch(() => {
        if (isMounted) {
          setError("Unable to start a dashboard session. Try again shortly.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const places: Place[] = useMemo(() => summary?.places ?? [], [summary]);

  const handleCreatePlace = async (place: PlaceCreate) => {
    setError("");
    await createPlace(place);
    await refreshWithFallback("Saved, but dashboard totals could not refresh.");
  };

  const handleBulk = async (csvText: string) => {
    setError("");
    await createBulkPlaces(csvText);
    await refreshWithFallback("Imported rows, but dashboard totals could not refresh.");
  };

  const handleDelete = async (placeId: string) => {
    setError("");
    comparisonVersionRef.current += 1;
    setComparison(null);
    try {
      await deletePlace(placeId);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(placeId);
        return next;
      });
      await refreshWithFallback("Removed place, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to remove place. Try again.");
    }
  };

  const handleToggle = (placeId: string) => {
    comparisonVersionRef.current += 1;
    setComparison(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
      }
      return next;
    });
  };

  async function handleAnalyze(request: {
    analysis_start_date: string;
    analysis_end_date: string;
    radii_m: number[];
    offense_category: string | null;
  }) {
    setError("");
    try {
      await analyzePlaces({ ...request, place_ids: Array.from(selectedIds) });
      await refreshWithFallback("Analysis ran, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to run analysis. Try again.");
    }
  }

  async function handleCompare(request: {
    analysis_start_date: string;
    analysis_end_date: string;
    radius_m: number;
    offense_category: string | null;
  }) {
    setError("");
    const comparisonVersion = comparisonVersionRef.current + 1;
    comparisonVersionRef.current = comparisonVersion;
    try {
      const result = await comparePlaces({
        ...request,
        place_ids: Array.from(selectedIds),
      });
      if (comparisonVersionRef.current === comparisonVersion) {
        setComparison(result);
      }
    } catch {
      if (comparisonVersionRef.current === comparisonVersion) {
        setError("Unable to compare places. Try again.");
      }
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Seattle reported incident context</p>
          <h1>Compare places you visit</h1>
        </div>
      </header>

      <section className="workspace" aria-labelledby="workspace-title">
        <div className="workspace-copy">
          <div className="section-kicker">
            <ShieldAlert size={18} />
            <span>Public incident context</span>
          </div>
          <h2 id="workspace-title">Incident context workspace</h2>
          <p>
            Start a session, add places manually or in bulk, and compare
            reported incident context without uploading personal location
            history.
          </p>
          {error ? <p className="error" role="status">{error}</p> : null}
        </div>

        <div className="summary-strip" aria-label="Dashboard totals">
          <div>
            <span>Places</span>
            <strong>{summary?.totals.place_count ?? places.length}</strong>
          </div>
          <div>
            <span>Visits</span>
            <strong>{summary?.totals.visit_count ?? 0}</strong>
          </div>
          <div>
            <span>Selected</span>
            <strong>{selectedIds.size}</strong>
          </div>
        </div>
      </section>

      <section className="dashboard-grid" aria-label="Place dashboard">
        <Notice />
        <PlaceForm onSubmit={handleCreatePlace} />
        <BulkPlaceEntry onSubmit={handleBulk} />
        <PlaceTable
          places={places}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
        <ResultsSummary summary={summary} />
        <AnalysisControls
          selectedCount={selectedIds.size}
          onAnalyze={handleAnalyze}
          onCompare={handleCompare}
        />
        <ComparisonPanel comparison={comparison} />
        <ExportPanel
          href={
            summary?.exports.tableau_place_summary_csv ||
            "/exports/tableau/place-summary.csv"
          }
        />
      </section>
    </main>
  );
}
