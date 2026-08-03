import { useState } from "react";

import { getAnalysisReport, getTrends } from "../api/client";
import { buildReportZip, downloadBlob, jsonBlob, printableBlob, reportFilename, trendCsvBlob, trendFilename } from "../lib/reportExport";
import { reportOverlapExplanation } from "../lib/reportOverlap";
import type { AnalysisReport, AnalysisSettings, LayerKey, NeighborhoodAnalysis } from "../types";
import { ReportReferencePlot } from "./ReportReferencePlot";
import { TrendSection } from "./TrendSection";

type Props = {
  report: AnalysisReport;
  neighborhood: NeighborhoodAnalysis | null;
  expanded: boolean;
  historical: boolean;
  workspaceAnalysis?: AnalysisSettings;
  onExpandChange: (expanded: boolean) => void;
  onRerun?: () => void;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const NO_REFERENCE_COPY: Partial<Record<LayerKey, { title: string; detail: string }>> = {
  arrests: {
    title: "No eligible-location reference distribution for arrests",
    detail: "Arrest locations reflect enforcement activity, so this report keeps the layer descriptive.",
  },
  calls: {
    title: "No eligible-location reference distribution for 911 calls",
    detail: "Calls reflect requests for service, so this report keeps the layer descriptive.",
  },
};

function formatDateTime(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function filterLabel(report: AnalysisReport): string {
  const active = Object.entries(report.scope.filters).filter(([, value]) => value);
  if (!active.length) return "All available types";
  return active.map(([field, value]) => `${field.replaceAll("_", " ")}: ${value}`).join(" · ");
}

function scopeMismatch(report: AnalysisReport, live?: AnalysisSettings): boolean {
  if (!live) return false;
  return report.scope.layer !== live.layer
    || report.scope.radius_m !== live.radiusM
    || report.scope.requested_start_date !== live.startDate
    || report.scope.requested_end_date !== live.endDate
    || (report.scope.filters.offense_category ?? "") !== live.offenseCategory;
}

export function ReportCard({ report, neighborhood, expanded, historical, workspaceAnalysis, onExpandChange, onRerun }: Props) {
  const [exporting, setExporting] = useState<"print" | "json" | "trend" | "zip" | null>(null);
  const [exportError, setExportError] = useState("");
  const mismatch = scopeMismatch(report, workspaceAnalysis);
  const overview = report.sections.overview;
  const overlapExplanation = reportOverlapExplanation(report);
  const maxPlaceCount = Math.max(1, ...report.sections.place_context.map((place) => place.record_count));
  const hasTrendContext = Boolean(neighborhood?.places.some((place) =>
    place.baselines?.some((baseline) => baseline.kind === "mcpp"),
  ));
  const trendLabels = [...new Set(neighborhood?.places.flatMap((place) =>
    place.baselines?.filter((baseline) => baseline.kind === "mcpp").map((baseline) => baseline.label) ?? [],
  ) ?? [])];

  async function currentExportReport(): Promise<AnalysisReport> {
    // Saved-place snapshots are revalidated against deletion/sensitivity policy immediately
    // before every download. Ad-hoc reports never left this browser and use the frozen DTO.
    return report.report_id ? getAnalysisReport(report.report_id) : report;
  }

  async function loadTrend(label: string) {
    return getTrends({
      mcpp: label,
      layer: report.scope.layer,
      category: report.scope.filters.offense_category,
    });
  }

  async function exportReport(kind: "print" | "json" | "zip") {
    setExporting(kind);
    setExportError("");
    try {
      const current = await currentExportReport();
      if (kind === "print") {
        const url = URL.createObjectURL(printableBlob(current));
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) {
          URL.revokeObjectURL(url);
          throw new Error("popup-blocked");
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else if (kind === "json") {
        downloadBlob(jsonBlob(current), reportFilename(current, "json"));
      } else {
        const trends = await Promise.all(trendLabels.map(loadTrend));
        downloadBlob(await buildReportZip(current, trends), reportFilename(current, "zip"));
      }
    } catch {
      setExportError("This report could not be exported. Saved-place privacy settings may have changed.");
    } finally {
      setExporting(null);
    }
  }
  async function exportTrend(label: string) {
    setExporting("trend");
    setExportError("");
    try {
      const current = await currentExportReport();
      const trend = await loadTrend(label);
      downloadBlob(trendCsvBlob(current, trend), trendFilename(current, trend));
    } catch {
      setExportError("This report could not be exported. Saved-place privacy settings may have changed.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <article className={`mc-result-card mc-report-card is-${report.scope.layer}${expanded ? " is-expanded" : ""}${historical ? " is-historical" : ""}`}>
      <header className="mc-report-head">
        <div>
          <span className="mc-report-kicker">{historical ? "Previous report" : "Analysis report"}</span>
          <h3>{report.profile.report_title}</h3>
          <p>{report.selection.map((selection) => selection.label).join(" · ")}</p>
        </div>
        <div className="mc-report-actions">
          <details className="mc-report-export">
            <summary>{exporting ? "Preparing…" : "Export"}</summary>
            <div role="menu">
              <button type="button" role="menuitem" disabled={exporting !== null} onClick={() => void exportReport("print")}>Print / save PDF</button>
              <button type="button" role="menuitem" disabled={exporting !== null} onClick={() => void exportReport("json")}>Report JSON</button>
              {trendLabels.map((label) => (
                <button key={label} type="button" role="menuitem" disabled={exporting !== null} onClick={() => void exportTrend(label)}>
                  Neighborhood trend CSV · {label}
                </button>
              ))}
              <button type="button" role="menuitem" disabled={exporting !== null} onClick={() => void exportReport("zip")}>Data package (ZIP)</button>
            </div>
          </details>
          <button type="button" className="mc-result-toggle" aria-label={expanded ? "Collapse" : "View details"} aria-expanded={expanded} onClick={() => onExpandChange(!expanded)}>
            {expanded ? "Collapse" : "View report"}
          </button>
        </div>
      </header>

      <div className="mc-report-scope" aria-label="Report scope">
        <span>{report.profile.counting_unit_label}</span>
        <span>{report.scope.radius_m} m radius</span>
        <span>{report.scope.effective_start_date} – {report.scope.effective_end_date}</span>
        <span>{filterLabel(report)}</span>
      </div>

      {mismatch ? (
        <div className="mc-report-mismatch" role="status">
          <div><strong>This frozen report does not match the current map controls.</strong><span>It remains unchanged so its figures and exports stay reproducible.</span></div>
          {onRerun ? <button type="button" className="mc-chip" onClick={onRerun}>Run current {workspaceAnalysis?.layer ?? "map"} report</button> : null}
        </div>
      ) : null}
      {exportError ? <p className="mc-inline-error" role="alert">{exportError}</p> : null}

      <div className="mc-report-overview">
        <div className="mc-report-total"><span>Unique source records</span><strong>{overview.unique_source_record_count}</strong><small>Unique-source-record basis</small></div>
        <div className="mc-report-facts">
          <div><span>Latest recorded event</span><strong>{report.scope.latest_recorded_event_date ?? "Not available"}</strong></div>
        </div>
        {overlapExplanation ? (
          <div className="mc-report-overlap" role="note">
            <strong>{overlapExplanation.headline}</strong>
            <span>{overlapExplanation.detail}</span>
          </div>
        ) : null}
        <p className="mc-report-provenance-line">
          Generated {formatDateTime(report.generated_at)} · Source row last ingested {formatDateTime(report.scope.latest_row_ingested_at)}
        </p>
      </div>

      {!expanded ? (
        <div className="mc-report-compact-places">
          {report.sections.place_context.map((place) => (
            <div key={place.selection_id}>
              <span>{place.label}</span><i aria-hidden="true"><b style={{ width: `${Math.round((place.record_count / maxPlaceCount) * 100)}%` }} /></i><strong>{place.record_count}</strong>
            </div>
          ))}
          <p>{report.disclosures[0]}</p>
        </div>
      ) : (
        <div className="mc-report-body">
          {report.sections.place_context.map((place) => {
            const maxType = Math.max(1, ...place.type_mix.map((row) => row.count));
            const maxDay = Math.max(1, ...place.temporal.dow_counts);
            const noReferenceCopy = NO_REFERENCE_COPY[report.scope.layer];
            return (
              <section className="mc-report-section" key={place.selection_id}>
                <header><div><span>Place context · per-place membership</span><h4>{place.label}</h4></div><strong>{place.record_count} {place.record_count === 1 ? report.profile.record_noun_singular : report.profile.record_noun_plural}</strong></header>
                <ReportReferencePlot
                  references={place.reference_context}
                  recordNounPlural={report.profile.record_noun_plural}
                />
                {!place.reference_context.length && noReferenceCopy ? (
                  <div className="mc-report-no-reference" role="note" aria-label="Why this report has no reference distribution">
                    <strong>{noReferenceCopy.title}</strong>
                    <span>{noReferenceCopy.detail}</span>
                  </div>
                ) : null}
                <div className="mc-report-observed-head">
                  <span>Exact report scope · per-place membership</span>
                  <h5>Observed pattern</h5>
                </div>
                <div className="mc-report-grid">
                  <div><h5>{report.profile.subtype_label} mix</h5>{place.type_mix.length ? place.type_mix.slice(0, 10).map((row) => (
                    <div className="mc-report-bar" key={row.label}><span title={row.label}>{row.label}</span><i aria-hidden="true"><b style={{ width: `${Math.round((row.count / maxType) * 100)}%` }} /></i><strong>{row.count}</strong></div>
                  )) : <p>No records in this window.</p>}</div>
                  <div><h5>Day of week</h5>{place.temporal.dow_counts.map((count, day) => (
                    <div className="mc-report-bar" key={DAYS[day]}><span>{DAYS[day]}</span><i aria-hidden="true"><b style={{ width: `${Math.round((count / maxDay) * 100)}%` }} /></i><strong>{count}</strong></div>
                  ))}</div>
                </div>
              </section>
            );
          })}

          {hasTrendContext && neighborhood ? (
            <section className="mc-report-section mc-report-context-trend">
              <div className="mc-report-context-label">
                <span>Broader neighborhood context · outside the {report.scope.radius_m} m report scope</span>
                <p>This chart is loaded separately from the frozen report and is labeled so it is not mistaken for the selected-radius result.</p>
              </div>
              <TrendSection
                neighborhood={neighborhood}
                layer={report.scope.layer}
                category={report.scope.filters.offense_category}
              />
            </section>
          ) : null}

          {report.sections.comparison ? (
            <section className="mc-report-section mc-report-comparison">
              <header><div><span>Reported-record model</span><h4>Modeled comparison</h4></div><strong>{report.sections.comparison.decision_class.replaceAll("_", " ")}</strong></header>
              <p>{report.sections.comparison.summary_text}</p>
              <p className="mc-report-note">{report.sections.comparison.caveat_text}</p>
            </section>
          ) : report.selection_kind === "multi_place" ? (
            <section className="mc-report-section mc-report-comparison"><header><div><span>Descriptive only</span><h4>Place counts</h4></div></header><p>This layer does not apply the reported-record comparison model. The per-place counts above are shown without a modeled verdict.</p></section>
          ) : null}

          <section className="mc-report-section">
            <header><div><span>Per-place membership</span><h4>Record disclosure</h4></div><strong>{report.sections.records.returned_count} of {report.sections.records.total_membership_count}</strong></header>
            {report.sections.records.truncated ? <p className="mc-report-note">This disclosure is truncated at {report.sections.records.limit} rows. The overview counts cover the complete result.</p> : null}
            <div className="mc-report-table-wrap"><table><thead><tr><th>Place</th><th>{report.profile.primary_time_label}</th><th>Category</th><th>{report.profile.subtype_label}</th><th>Distance</th></tr></thead><tbody>
              {report.sections.records.records.map((record, index) => <tr key={`${record.selection_id}-${record.primary_time}-${index}`}><td>{record.place_label}</td><td>{formatDateTime(record.primary_time)}</td><td>{record.offense_category ?? "—"}</td><td>{record.offense_subcategory ?? record.arrest_offense_description ?? record.call_type ?? "—"}</td><td>{Math.round(record.distance_m)} m</td></tr>)}
            </tbody></table></div>
          </section>

          <footer className="mc-report-disclosures">{report.disclosures.map((disclosure) => <p key={disclosure}>{disclosure}</p>)}<p>Schema {report.schema_version} · Method {report.method_version} · Artifact coordinates generalized to {report.export_policy.artifact_coordinate_decimals} decimals.</p></footer>
        </div>
      )}
    </article>
  );
}
