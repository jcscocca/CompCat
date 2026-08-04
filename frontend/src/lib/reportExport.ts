import type { AnalysisReport, ReportRecord, ReportSelection, TrendsResponse } from "../types";
import { reportOverlapExplanation, reportOverlapMetrics } from "./reportOverlap";
import { anchorFactor, indexCitywide, rollingMean12 } from "./trendMath";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const RISKY_FORMULA_PREFIX = /^[=+\-@\t\r]/;

type CsvValue = string | number | boolean | null | undefined;
type ReportFiles = Record<string, Uint8Array>;

const SELECTED_LOCATION_HEADERS = [
  "selected_location",
  "selected_location_latitude_generalized",
  "selected_location_longitude_generalized",
  "selected_radius_m",
];

const REPORT_FILTER_HEADERS = [
  "offense_category_filter",
  "offense_subcategory_filter",
  "arrest_offense_description_filter",
  "call_type_filter",
  "nibrs_group_filter",
];

function primarySelection(report: AnalysisReport): ReportSelection {
  const selection = report.selection[0];
  if (!selection) throw new Error("Reports require at least one selected location.");
  return selection;
}

function selectedLocationValues(report: AnalysisReport): CsvValue[] {
  const selection = primarySelection(report);
  return [selection.label, selection.latitude, selection.longitude, report.scope.radius_m];
}

function reportFilterValues(report: AnalysisReport): CsvValue[] {
  return [
    report.scope.filters.offense_category,
    report.scope.filters.offense_subcategory,
    report.scope.filters.arrest_offense_description,
    report.scope.filters.call_type,
    report.scope.filters.nibrs_group,
  ];
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** RFC 4180 cell encoding plus spreadsheet-formula neutralization for string values. */
export function csvCell(value: CsvValue): string {
  if (value == null) return "";
  let text = String(value);
  if (typeof value === "string" && RISKY_FORMULA_PREFIX.test(value)) text = `'${value}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: CsvValue[][]): Uint8Array {
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return encoder.encode(`${lines.join("\r\n")}\r\n`);
}

const TREND_HEADERS = [
  ...SELECTED_LOCATION_HEADERS,
  "context_scope",
  "layer",
  ...REPORT_FILTER_HEADERS,
  "category",
  "mcpp",
  "mcpp_label",
  "month",
  "neighborhood_monthly_count",
  "neighborhood_12_month_average",
  "citywide_monthly_count",
  "citywide_indexed_to_neighborhood",
];

function trendRows(report: AnalysisReport, trends: TrendsResponse[]): CsvValue[][] {
  const selectedLocation = selectedLocationValues(report);
  return trends.flatMap((trend) => {
    const enoughMonths = trend.months.length >= 13;
    const rolling = enoughMonths
      ? rollingMean12(trend.area_counts)
      : trend.months.map(() => null);
    const factor = enoughMonths ? anchorFactor(trend.area_counts, trend.citywide_counts) : null;
    const indexed = factor === null ? trend.months.map(() => null) : indexCitywide(trend.citywide_counts, factor);
    return trend.months.map((month, index) => [
      ...selectedLocation,
      "broader_neighborhood_outside_selected_radius",
      trend.layer,
      ...reportFilterValues(report),
      trend.category,
      trend.mcpp,
      trend.mcpp_label,
      month,
      trend.area_counts[index] ?? 0,
      rolling[index],
      trend.citywide_counts[index] ?? 0,
      indexed[index],
    ]);
  });
}

function trendCsvBytes(report: AnalysisReport, trends: TrendsResponse[]): Uint8Array {
  return csv(TREND_HEADERS, trendRows(report, trends));
}

function common(report: AnalysisReport): CsvValue[] {
  return [
    report.schema_version,
    report.method_version,
    ...selectedLocationValues(report),
    report.scope.layer,
    report.scope.source_dataset,
    report.scope.counting_unit,
    report.scope.effective_start_date,
    report.scope.effective_end_date,
    ...reportFilterValues(report),
    report.generated_at,
  ];
}

const COMMON_HEADERS = [
  "schema_version",
  "method_version",
  ...SELECTED_LOCATION_HEADERS,
  "layer",
  "source_dataset",
  "counting_unit",
  "effective_start_date",
  "effective_end_date",
  ...REPORT_FILTER_HEADERS,
  "generated_at",
];

function subtype(record: ReportRecord): string | null {
  return record.offense_subcategory
    ?? record.arrest_offense_description
    ?? record.call_type;
}

function filterSummary(report: AnalysisReport): string {
  const entries = Object.entries(report.scope.filters).filter(([, value]) => value);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join("; ") : "All available types";
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function buildPrintableHtml(report: AnalysisReport): string {
  const selectedLocation = primarySelection(report);
  const additionalLocationCount = report.selection.length - 1;
  const selectedLocationDetail = additionalLocationCount
    ? `Primary of ${report.selection.length} selected locations`
    : "Selected map location";
  const overview = report.sections.overview;
  const overlap = reportOverlapExplanation(report);
  const overlapHtml = overlap
    ? `<p class="overlap"><strong>${escapeHtml(overlap.headline)}</strong><span>${escapeHtml(overlap.detail)}</span></p>`
    : "";
  const comparison = report.sections.comparison;
  const places = report.sections.place_context.map((place) => {
    const max = Math.max(1, ...place.type_mix.map((row) => row.count));
    const bars = place.type_mix.slice(0, 8).map((row) => `
      <div class="bar"><span>${escapeHtml(row.label)}</span><i><b style="width:${Math.round((row.count / max) * 100)}%"></b></i><strong>${row.count}</strong></div>`).join("");
    const references = place.reference_context.map((reference) => `
      <p class="reference"><strong>${escapeHtml(reference.label)}</strong>: ${reference.available
        ? `${reference.target_count} at the selected place; reference median ${reference.median ?? "not available"}.`
        : `not available (${escapeHtml(reference.adequacy_status)}).`}</p>`).join("");
    return `<section class="place"><h2>${escapeHtml(place.label)}</h2><p class="count"><strong>${place.record_count}</strong> ${escapeHtml(report.profile.record_noun_plural)} · per-place membership</p>${bars || "<p>No type-mix rows in this window.</p>"}${references}</section>`;
  }).join("");
  const comparisonHtml = comparison ? `<section><h2>Modeled comparison</h2><p>${escapeHtml(comparison.summary_text)}</p><p class="note">${escapeHtml(comparison.caveat_text)}</p></section>` : "";
  const recordRows = report.sections.records.records.slice(0, 100).map((record) => `<tr>
    <td>${escapeHtml(record.place_label)}</td><td>${escapeHtml(formatDateTime(record.primary_time))}</td>
    <td>${escapeHtml(record.offense_category ?? "")}</td><td>${escapeHtml(subtype(record) ?? "")}</td>
    <td>${record.distance_m.toFixed(0)} m</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(selectedLocation.label)} — ${escapeHtml(report.profile.report_title)}</title><style>
  :root{color:#17221d;background:#eef1ec;font:14px/1.45 Inter,system-ui,sans-serif}body{margin:0}.page{max-width:920px;margin:0 auto;background:#fff;min-height:100vh;padding:38px 44px;box-sizing:border-box}header{border-bottom:3px solid #176b50;padding-bottom:20px}.eyebrow{color:#176b50;font-weight:800;text-transform:uppercase;letter-spacing:.08em}h1{font:700 32px/1.1 Georgia,serif;margin:8px 0}.scope,.meta{display:flex;gap:10px;flex-wrap:wrap}.pill{background:#edf5f1;border:1px solid #bdd5ca;border-radius:999px;padding:5px 10px}.hero{display:grid;grid-template-columns:1.2fr 1fr;gap:22px;margin:24px 0}.total{background:#173b30;color:white;border-radius:12px;padding:22px}.total>strong{font-size:44px;display:block}.overlap{display:grid;gap:3px;margin:14px 0 0;padding-top:12px;border-top:1px solid rgba(255,255,255,.28);font-size:12px}.overlap strong{font-size:13px}.overlap span{color:rgba(255,255,255,.82)}.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fact{border:1px solid #dce4df;border-radius:10px;padding:10px}.fact span{display:block;color:#66736d;font-size:12px}.place,section{break-inside:avoid;border-top:1px solid #dce4df;padding:18px 0}.bar{display:grid;grid-template-columns:minmax(120px,1fr) 2fr 40px;gap:10px;align-items:center;margin:7px 0}.bar i{height:8px;background:#e7ece9;border-radius:8px;overflow:hidden}.bar b{display:block;height:100%;background:#3d8a70}.note,.reference{color:#53625b}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;border-bottom:1px solid #dce4df;padding:7px 5px}footer{margin-top:24px;border-top:1px solid #aebbb5;padding-top:14px;color:#53625b;font-size:12px}@media print{:root{background:white}.page{padding:0}.no-print{display:none}}@media(max-width:640px){.page{padding:24px 18px}.hero{grid-template-columns:1fr}.facts{grid-template-columns:1fr}}
  </style></head><body><main class="page"><header><div class="eyebrow">CompCat · reported public-safety context</div><h1>${escapeHtml(report.profile.report_title)}</h1><p><strong>Primary selected location: ${escapeHtml(selectedLocation.label)}</strong><br><span class="note">${escapeHtml(selectedLocationDetail)} · generalized coordinates ${selectedLocation.latitude.toFixed(3)}, ${selectedLocation.longitude.toFixed(3)}</span></p><div class="scope"><span class="pill">${escapeHtml(report.profile.counting_unit_label)}</span><span class="pill">${report.scope.radius_m} m radius</span><span class="pill">${escapeHtml(report.scope.effective_start_date)} – ${escapeHtml(report.scope.effective_end_date)}</span><span class="pill">${escapeHtml(filterSummary(report))}</span></div></header>
  <section class="hero"><div class="total"><span>Unique source records</span><strong>${overview.unique_source_record_count}</strong><small>Unique-source-record basis.</small>${overlapHtml}</div><div class="facts"><div class="fact"><span>Latest recorded event</span><strong>${escapeHtml(report.scope.latest_recorded_event_date ?? "Not available")}</strong></div><div class="fact"><span>Latest row ingested</span><strong>${escapeHtml(formatDateTime(report.scope.latest_row_ingested_at))}</strong></div><div class="fact"><span>Generated</span><strong>${escapeHtml(formatDateTime(report.generated_at))}</strong></div><div class="fact"><span>Source</span><strong>${escapeHtml(report.scope.source_dataset)}</strong></div></div></section>
  ${places}${comparisonHtml}<section><h2>Record disclosure</h2><p class="note">Showing ${report.sections.records.returned_count} of ${report.sections.records.total_membership_count} per-place memberships${report.sections.records.truncated ? "; disclosure is truncated" : ""}.</p><table><thead><tr><th>Place</th><th>${escapeHtml(report.profile.primary_time_label)}</th><th>Category</th><th>${escapeHtml(report.profile.subtype_label)}</th><th>Distance</th></tr></thead><tbody>${recordRows}</tbody></table></section>
  <footer>${report.disclosures.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}<p>Schema ${escapeHtml(report.schema_version)} · Method ${escapeHtml(report.method_version)} · Coordinates are generalized to ${report.export_policy.artifact_coordinate_decimals} decimal places.</p></footer></main></body></html>`;
}

export function buildReportJson(report: AnalysisReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function buildReportPackageFiles(
  report: AnalysisReport,
  trends: TrendsResponse[] = [],
): Promise<ReportFiles> {
  const base = common(report);
  const overlap = reportOverlapMetrics(report);
  const files: ReportFiles = {
    "overview.csv": csv([...COMMON_HEADERS, "unique_counting_basis", "unique_source_record_count", "membership_counting_basis", "membership_count", "shared_source_record_count", "additional_membership_count", "maximum_places_per_record", "returned_record_count", "records_truncated"], [[...base, report.sections.overview.unique_counting_basis, report.sections.overview.unique_source_record_count, report.sections.overview.membership_counting_basis, report.sections.overview.membership_count, overlap.sharedSourceRecordCount, overlap.additionalMembershipCount, overlap.maximumPlacesPerRecord, report.sections.overview.returned_record_count, report.sections.overview.records_truncated]]),
    "places.csv": csv([...COMMON_HEADERS, "selection_id", "label", "latitude_generalized", "longitude_generalized", "record_count", "counting_basis"], report.selection.map((selection) => {
      const context = report.sections.place_context.find((place) => place.selection_id === selection.selection_id);
      return [...base, selection.selection_id, selection.label, selection.latitude, selection.longitude, context?.record_count ?? 0, "per_place_membership"];
    })),
    "type_mix.csv": csv([...COMMON_HEADERS, "selection_id", "place_label", "type_label", "count", "share", "counting_basis"], report.sections.place_context.flatMap((place) => place.type_mix.map((row) => [...base, place.selection_id, place.label, row.label, row.count, row.share, row.counting_basis]))),
    "temporal.csv": csv([...COMMON_HEADERS, "selection_id", "place_label", "bucket_kind", "bucket", "count", "counting_basis"], report.sections.place_context.flatMap((place) => [
      ...place.temporal.hour_counts.map((count, hour) => [...base, place.selection_id, place.label, "hour", hour, count, place.temporal.counting_basis]),
      ...place.temporal.dow_counts.map((count, dow) => [...base, place.selection_id, place.label, "weekday_monday_zero", dow, count, place.temporal.counting_basis]),
      ...Object.entries(place.temporal.monthly_counts).map(([month, count]) => [...base, place.selection_id, place.label, "month", month, count, place.temporal.counting_basis]),
    ])),
    "records.csv": csv([...COMMON_HEADERS, "selection_id", "place_label", "primary_time", "secondary_time", "offense_category", report.profile.subtype_field, "nibrs_group", "distance_m", "duplicate_across_places", "counting_basis"], report.sections.records.records.map((record) => [...base, record.selection_id, record.place_label, record.primary_time, record.secondary_time, record.offense_category, subtype(record), record.nibrs_group, record.distance_m, record.duplicate_across_places, record.counting_basis])),
    "report.json": encoder.encode(buildReportJson(report)),
    "printable.html": encoder.encode(buildPrintableHtml(report)),
  };
  if (report.profile.capabilities.reference_context) {
    files["reference_context.csv"] = csv([...COMMON_HEADERS, "selection_id", "place_label", "reference_kind", "reference_label", "available", "adequacy_status", "target_count", "reference_center_count", "reference_draw_count", "p10", "p25", "median", "p75", "p90", "counting_basis"], report.sections.place_context.flatMap((place) => place.reference_context.map((row) => [...base, place.selection_id, place.label, row.kind, row.label, row.available, row.adequacy_status, row.target_count, row.reference_center_count, row.reference_draw_count, row.p10, row.p25, row.median, row.p75, row.p90, row.counting_basis])));
  }
  if (report.sections.comparison) {
    files["comparison.csv"] = csv([...COMMON_HEADERS, "selection_a", "selection_b", "decision_class", "method", "record_count_a", "record_count_b", "rate_a", "rate_b", "rate_ratio", "ci_lower", "ci_upper", "adjusted_p_value", "minimum_data_status", "counting_basis"], report.sections.comparison.pairwise_results.map((row) => [...base, row.selection_a_label, row.selection_b_label, row.decision_class, row.method, row.record_count_a, row.record_count_b, row.rate_a, row.rate_b, row.rate_ratio, row.ci_lower, row.ci_upper, row.adjusted_p_value, row.minimum_data_status, row.counting_basis]));
  }
  if (trends.length) {
    files["neighborhood_trends.csv"] = trendCsvBytes(report, trends);
  }
  const selectedLocation = primarySelection(report);
  const checksums: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) checksums[name] = await sha256(bytes);
  files["metadata.json"] = encoder.encode(`${JSON.stringify({
    schema_version: report.schema_version,
    method_version: report.method_version,
    report_id: report.report_id,
    selected_location: selectedLocation.label,
    selected_location_latitude_generalized: selectedLocation.latitude,
    selected_location_longitude_generalized: selectedLocation.longitude,
    selected_radius_m: report.scope.radius_m,
    filters: report.scope.filters,
    selected_locations: report.selection.map((selection) => ({
      selection_id: selection.selection_id,
      label: selection.label,
      latitude_generalized: selection.latitude,
      longitude_generalized: selection.longitude,
    })),
    layer: report.scope.layer,
    generated_at: report.generated_at,
    packaged_at: new Date().toISOString(),
    counting_unit: report.scope.counting_unit,
    counting_bases: ["unique_source_records", "per_place_membership"],
    overlap_summary: {
      shared_source_record_count: overlap.sharedSourceRecordCount,
      additional_membership_count: overlap.additionalMembershipCount,
      maximum_places_per_record: overlap.maximumPlacesPerRecord,
    },
    coordinate_decimals: report.export_policy.artifact_coordinate_decimals,
    checksums_sha256: checksums,
  }, null, 2)}\n`);
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff]; }
function u32(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]; }

/** Small dependency-free ZIP writer using the STORE method; reports are already compact. */
export function createStoredZip(files: ReportFiles): Uint8Array {
  const locals: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const filename = encoder.encode(name);
    const crc = crc32(data);
    const local = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(filename.length), ...u16(0), ...filename, ...data];
    locals.push(...local);
    central.push(0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(filename.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...filename);
    offset += local.length;
  }
  const count = Object.keys(files).length;
  const end = [0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(locals.length), ...u16(0)];
  return new Uint8Array([...locals, ...central, ...end]);
}

export async function buildReportZip(
  report: AnalysisReport,
  trends: TrendsResponse[] = [],
): Promise<Blob> {
  const bytes = new Uint8Array(createStoredZip(await buildReportPackageFiles(report, trends)));
  return new Blob([bytes.buffer], { type: "application/zip" });
}

export function reportFilename(report: AnalysisReport, extension: string): string {
  const additionalLocations = report.selection.length - 1;
  const location = filenamePart(primarySelection(report).label);
  const selection = additionalLocations ? `${location}-plus-${additionalLocations}` : location;
  return `compcat-${report.scope.layer}-${selection}-report-${report.generated_at.slice(0, 10)}.${extension}`;
}

function filenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "location";
}

export function trendFilename(report: AnalysisReport, trend: TrendsResponse): string {
  return `compcat-${report.scope.layer}-${filenamePart(primarySelection(report).label)}-${filenamePart(trend.mcpp_label)}-neighborhood-trend-${report.generated_at.slice(0, 10)}.csv`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printableBlob(report: AnalysisReport): Blob {
  return new Blob([buildPrintableHtml(report)], { type: "text/html;charset=utf-8" });
}

export function jsonBlob(report: AnalysisReport): Blob {
  return new Blob([buildReportJson(report)], { type: "application/json;charset=utf-8" });
}

export function trendCsvBlob(report: AnalysisReport, trend: TrendsResponse): Blob {
  const bytes = new Uint8Array(trendCsvBytes(report, [trend]));
  return new Blob([bytes.buffer], { type: "text/csv;charset=utf-8" });
}

/** Test helper for inspecting generated UTF-8 files without depending on a ZIP reader. */
export function decodeReportFile(bytes: Uint8Array): string { return decoder.decode(bytes); }
