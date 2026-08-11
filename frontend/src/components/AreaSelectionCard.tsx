import { useRef, useState, type KeyboardEvent } from "react";

import { formatIncidentAddress, titleCase } from "../lib/addressLabel";
import { countNoun, type IncidentNoun } from "../lib/layerCopy";
import type {
  AreaDrawMode,
  AreaSelectionFilters,
  AreaSelectionRecordsResponse,
  AreaSelectionSummary,
} from "../types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Tab = "summary" | "data";

function formatScopeDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function Bars({
  counts,
  labels,
  label,
  selected,
  onToggle,
}: {
  counts: number[];
  labels: string[];
  label: string;
  selected: number[];
  onToggle: (index: number) => void;
}) {
  const max = Math.max(1, ...counts);
  return (
    <div className="mc-area-bars-block">
      <div className="mc-area-bars" role="group" aria-label={`${label}. Select one or more buckets to filter the area.`}>
        {counts.map((count, index) => (
          <button key={labels[index]} type="button" title={`${labels[index]}: ${count}`} aria-label={`${labels[index]}: ${count}`} aria-pressed={selected.includes(index)} onClick={() => onToggle(index)}>
            <i style={{ height: `${Math.max(count > 0 ? 4 : 0, count / max * 100)}%` }} />
          </button>
        ))}
      </div>
      {counts.length > 12 ? <p className="mc-area-scroll-hint">Scroll for all 24 hours →</p> : null}
      <details className="mc-chart-data">
        <summary>View exact values</summary>
        <table>
          <thead><tr><th scope="col">Bucket</th><th scope="col">Count</th></tr></thead>
          <tbody>{counts.map((count, index) => (
            <tr key={labels[index]}><th scope="row"><button type="button" aria-pressed={selected.includes(index)} onClick={() => onToggle(index)}>{labels[index]}</button></th><td>{count}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  );
}

function SummaryTab({
  summary,
  baseSummary,
  filters,
  noun,
  onToggleType,
  onToggleHour,
  onToggleDay,
}: {
  summary: AreaSelectionSummary;
  baseSummary: AreaSelectionSummary | null;
  filters: AreaSelectionFilters;
  noun: IncidentNoun;
  onToggleType: (label: string) => void;
  onToggleHour: (hour: number) => void;
  onToggleDay: (day: number) => void;
}) {
  const active = filters.selectedTypes.length + filters.selectedHours.length + filters.selectedDays.length > 0;
  const optionSummary = baseSummary ?? summary;
  const visibleTypeLabels = new Set(optionSummary.type_mix.filter((row) => row.label !== "Other").map((row) => row.label));
  const typeRows = optionSummary.type_mix.map((row) => {
    const count = row.label === "Other"
      ? Object.entries(summary.type_counts).reduce((total, [label, value]) => total + (visibleTypeLabels.has(label) ? 0 : value), 0)
      : summary.type_counts[row.label] ?? 0;
    return { ...row, count, share: summary.record_count ? count / summary.record_count : 0 };
  });
  const maxType = Math.max(1, ...typeRows.map((row) => row.count));
  const temporalOptionsAvailable = optionSummary.temporal.total_with_time > 0;
  const missingTimeScope = active ? "matching" : "area";
  return (
    <div className="mc-area-summary">
      <div className="mc-area-total">
        <strong>{summary.record_count.toLocaleString()}</strong>
        <span>{countNoun(noun, summary.record_count)} across {summary.location_count.toLocaleString()} mapped block {summary.location_count === 1 ? "location" : "locations"}{active ? `, matching filters (${optionSummary.record_count.toLocaleString()} total in area)` : ""}</span>
      </div>
      {active && summary.record_count === 0 ? <p className="mc-area-note" role="status">No records match the active filters. Adjust or clear a filter to continue.</p> : null}
      <section>
        <h4>Type mix</h4>
        {typeRows.length ? (
          <div className="mc-area-type-list">
            {typeRows.map((row) => (
              <button key={row.label} type="button" aria-label={`${titleCase(row.label)}: ${row.count}`} aria-pressed={filters.selectedTypes.includes(row.label)} disabled={row.label === "Other"} title={row.label === "Other" ? "Grouped types remain available in the Data table." : `${row.label}: ${row.count}`} onClick={() => onToggleType(row.label)}>
                <span>{titleCase(row.label)}</span>
                <i><b style={{ width: `${row.count / maxType * 100}%` }} /></i>
                <strong>{row.count}</strong>
              </button>
            ))}
          </div>
        ) : <p>No matching records.</p>}
      </section>
      <section>
        <h4>When records occurred</h4>
        {temporalOptionsAvailable ? (
          <>
            <h5>Hour of day</h5>
            <Bars counts={summary.temporal.hour_counts} labels={Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`)} label="Records by hour of day" selected={filters.selectedHours} onToggle={onToggleHour} />
            <h5>Day of week</h5>
            <Bars counts={summary.temporal.dow_counts} labels={DAYS} label="Records by day of week" selected={filters.selectedDays} onToggle={onToggleDay} />
          </>
        ) : <p>No matching records have a recorded primary time.</p>}
        {summary.temporal.without_time ? <p className="mc-area-note">{summary.temporal.without_time} {missingTimeScope} {summary.temporal.without_time === 1 ? "record has" : "records have"} no primary time and {summary.temporal.without_time === 1 ? "is" : "are"} excluded from these charts.</p> : null}
      </section>
      <p className="mc-area-note">Only records with public mappable coordinates can be assigned to this area.</p>
      {summary.highlight_mode === "grid" ? <p className="mc-area-note">The map groups this large selection into geographic cells; counts and data still cover every matching record.</p> : null}
    </div>
  );
}

function FilterChips({
  filters,
  onToggleType,
  onToggleHour,
  onToggleDay,
  onClear,
}: {
  filters: AreaSelectionFilters;
  onToggleType: (label: string) => void;
  onToggleHour: (hour: number) => void;
  onToggleDay: (day: number) => void;
  onClear: () => void;
}) {
  const count = filters.selectedTypes.length + filters.selectedHours.length + filters.selectedDays.length;
  if (!count) return null;
  return (
    <div className="mc-area-filter-chips" aria-label="Active area data filters">
      <span>Filtered by</span>
      {filters.selectedTypes.map((label) => <button key={`type-${label}`} type="button" aria-label={`Remove ${titleCase(label)} filter`} onClick={() => onToggleType(label)}>{titleCase(label)} ×</button>)}
      {filters.selectedHours.map((hour) => <button key={`hour-${hour}`} type="button" aria-label={`Remove ${String(hour).padStart(2, "0")}:00 filter`} onClick={() => onToggleHour(hour)}>{String(hour).padStart(2, "0")}:00 ×</button>)}
      {filters.selectedDays.map((day) => <button key={`day-${day}`} type="button" aria-label={`Remove ${DAYS[day]} filter`} onClick={() => onToggleDay(day)}>{DAYS[day]} ×</button>)}
      <button type="button" className="mc-area-clear-filters" onClick={onClear}>Clear filters</button>
    </div>
  );
}

function recordTime(occurred: string | null, reported: string | null) {
  const value = occurred || reported;
  return value ? `${value.slice(0, 10)} ${value.slice(11, 16)} Seattle time` : "Unknown";
}

function RecordsTab({
  records,
  loading,
  noun,
  pageSize,
  pageNumber,
  canPrevious,
  canNext,
  onPageSize,
  onPrevious,
  onNext,
}: {
  records: AreaSelectionRecordsResponse | null;
  loading: boolean;
  noun: IncidentNoun;
  pageSize: number;
  pageNumber: number;
  canPrevious: boolean;
  canNext: boolean;
  onPageSize: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mc-area-data">
      <div className="mc-area-page-controls">
        <label>Rows <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <span>Page {pageNumber}</span>
        <button type="button" disabled={!canPrevious || loading} onClick={onPrevious}>Previous</button>
        <button type="button" disabled={!canNext || loading} onClick={onNext}>Next</button>
      </div>
      {loading ? <p role="status">Loading selected records…</p> : records?.records.length ? (
        <div className="mc-area-records-wrap" tabIndex={0} role="region" aria-label="Area records table; scroll horizontally to view all columns">
          <table className="mc-area-records">
            <thead><tr><th scope="col">Date/time</th><th scope="col">Type</th><th scope="col">Block/address</th><th scope="col">ID</th></tr></thead>
            <tbody>{records.records.map((record) => (
              <tr key={record.incident_id}>
                <td>{recordTime(record.occurred_at, record.reported_at)}</td>
                <td>{titleCase(record.offense_subcategory || record.offense_category || noun.singular)}</td>
                <td>{formatIncidentAddress(record.block_address)}</td>
                <td>{record.report_number || record.external_incident_id || record.incident_id}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>No matching {noun.plural}.</p>}
    </div>
  );
}

export function AreaSelectionCard({
  summary,
  baseSummary,
  summaryLoading,
  records,
  recordsLoading,
  error,
  noun,
  analysisStartDate,
  analysisEndDate,
  pageSize,
  pageNumber,
  canPrevious,
  canNext,
  filters,
  onPageSize,
  onPrevious,
  onNext,
  onToggleType,
  onToggleHour,
  onToggleDay,
  onClearFilters,
  onRedraw,
  onClear,
  onClose,
  onExport,
}: {
  summary: AreaSelectionSummary | null;
  baseSummary: AreaSelectionSummary | null;
  summaryLoading: boolean;
  records: AreaSelectionRecordsResponse | null;
  recordsLoading: boolean;
  error: string | null;
  noun: IncidentNoun;
  analysisStartDate: string;
  analysisEndDate: string;
  pageSize: number;
  pageNumber: number;
  canPrevious: boolean;
  canNext: boolean;
  filters: AreaSelectionFilters;
  onPageSize: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleType: (label: string) => void;
  onToggleHour: (hour: number) => void;
  onToggleDay: (day: number) => void;
  onClearFilters: () => void;
  onRedraw: (mode: AreaDrawMode) => void;
  onClear: () => void;
  onClose: () => void;
  onExport: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
    const value: Tab = next === 0 ? "summary" : "data";
    setTab(value);
    tabsRef.current[next]?.focus();
  }

  async function exportAll() {
    setExporting(true);
    setExportError(null);
    try {
      await onExport();
    } catch {
      setExportError("The selected records could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <article className="mc-area-card" aria-labelledby="mc-area-title">
      <header>
        <div><span className="mc-area-kicker">Map selection</span><h3 id="mc-area-title">Area data</h3></div>
        <p className="mc-area-scope">
          <span>Date range</span>
          <strong>{formatScopeDate(analysisStartDate)} — {formatScopeDate(analysisEndDate)}</strong>
        </p>
        <button type="button" aria-label="Close area data" onClick={onClose}>×</button>
      </header>
      <div className="mc-area-actions">
        <details><summary>Redraw</summary>{(["rectangle", "polygon", "lasso"] as AreaDrawMode[]).map((mode) => <button key={mode} type="button" onClick={() => onRedraw(mode)}>{titleCase(mode)}</button>)}</details>
        <button type="button" disabled={!summary || exporting} onClick={() => void exportAll()}>{exporting ? "Exporting…" : "Export CSV"}</button>
        <button type="button" onClick={onClear}>Clear</button>
      </div>
      <FilterChips filters={filters} onToggleType={onToggleType} onToggleHour={onToggleHour} onToggleDay={onToggleDay} onClear={onClearFilters} />
      <div className="mc-area-tabs" role="tablist" aria-label="Area data views">
        {(["summary", "data"] as Tab[]).map((value, index) => (
          <button key={value} ref={(element) => { tabsRef.current[index] = element; }} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls={`mc-area-${value}`} onClick={() => setTab(value)} onKeyDown={(event) => tabKeyDown(event, index)}>{titleCase(value)}</button>
        ))}
      </div>
      {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}
      {exportError ? <p className="mc-inline-error" role="alert">{exportError}</p> : null}
      <div id={`mc-area-${tab}`} role="tabpanel" tabIndex={0}>
        {tab === "summary" ? (
          summaryLoading ? <p role="status">Filtering selected area…</p> : summary ? <SummaryTab summary={summary} baseSummary={baseSummary} filters={filters} noun={noun} onToggleType={onToggleType} onToggleHour={onToggleHour} onToggleDay={onToggleDay} /> : null
        ) : (
          <RecordsTab records={records} loading={recordsLoading} noun={noun} pageSize={pageSize} pageNumber={pageNumber} canPrevious={canPrevious} canNext={canNext} onPageSize={onPageSize} onPrevious={onPrevious} onNext={onNext} />
        )}
      </div>
    </article>
  );
}
