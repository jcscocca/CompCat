import { useEffect, useRef, useState, type ReactNode } from "react";

import { ANALYSIS_MIN_DATE } from "../lib/analysisDefaults";
import {
  analysisDateRangeError,
  maxAnalysisDate,
} from "../lib/analysisDateRange";
import { analysisDatePresetWindow, type AnalysisDatePreset } from "../lib/analysisDatePresets";
import {
  MAX_ANALYSIS_RADIUS_M,
  MIN_ANALYSIS_RADIUS_M,
  parseAnalysisRadius,
} from "../lib/analysisRadius";
import { incidentNoun, layerDisclosure } from "../lib/layerCopy";
import { CATEGORIES, categoryLabel } from "../lib/offenseCategories";
import type { AnalysisSettings, LayerKey } from "../types";

type FilterMenu = "dates" | "radius" | "category" | "layer";

const LAYERS: { value: LayerKey; label: string }[] = [
  { value: "reported", label: "Reported incidents" },
  { value: "arrests", label: "Arrests" },
  { value: "calls", label: "911 calls" },
];

type Props = {
  analysis: AnalysisSettings;
  availableRadii: number[];
  onChange: (patch: Partial<AnalysisSettings>) => void;
  /** False means the freshness endpoint confirmed that this layer has no loaded rows. */
  layerAvailability?: Partial<Record<LayerKey, boolean>>;
  /** Saved-place selection belongs to the analysis context, so it is composed into
   * this single control instead of living in a second toolbar at the top of the rail. */
  locationControls?: ReactNode;
  /** Secondary context that belongs with the filters instead of competing with the
   * primary layer selector in the workspace header. */
  metadata?: ReactNode;
  /** Copies the share link and reports success/failure (the caller owns the URL + the
   * clipboard write); the strip only owns the transient status note. */
  onCopyLink?: () => Promise<boolean> | boolean;
  copyDisabled?: boolean;
  /** Fields most recently changed by a Tabby tool call. They receive a short visual
   * confirmation while the matching deterministic receipt is announced in the thread. */
  assistantUpdatedFields?: (keyof AnalysisSettings)[];
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? "is-open" : ""} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Checkmark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

/** The live dashboard context above Tabby's input. Each visible value is its own
 * disclosure button, so changing a filter no longer requires opening a separate editor. */
export function ContextStrip({
  analysis,
  availableRadii,
  onChange,
  layerAvailability,
  locationControls,
  metadata,
  onCopyLink,
  copyDisabled,
  assistantUpdatedFields = [],
}: Props) {
  const [openMenu, setOpenMenu] = useState<FilterMenu | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<FilterMenu, HTMLButtonElement | null>>({
    dates: null,
    radius: null,
    category: null,
    layer: null,
  });
  const radii = Array.from(new Set(availableRadii.length > 0 ? availableRadii : [250, 500, 1000]))
    .filter((value) => value >= MIN_ANALYSIS_RADIUS_M && value <= MAX_ANALYSIS_RADIUS_M)
    .sort((a, b) => a - b);
  const disclosure = layerDisclosure(analysis.layer);
  const showCategories = analysis.layer !== "calls";
  const activeCategoryLabel = categoryLabel(analysis.offenseCategory, analysis.layer);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);
  const [dateInputError, setDateInputError] = useState("");
  const [radiusInput, setRadiusInput] = useState(String(analysis.radiusM));
  const [radiusInputError, setRadiusInputError] = useState("");
  const currentDateError = analysisDateRangeError(analysis.startDate, analysis.endDate);
  const datesValid = currentDateError === null;
  const dateError = dateInputError || currentDateError || "";
  const latestAnalysisDate = maxAnalysisDate();

  useEffect(() => () => {
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
  }, []);

  useEffect(() => {
    if (datesValid) setDateInputError("");
  }, [analysis.startDate, analysis.endDate, datesValid]);

  useEffect(() => {
    if (openMenu === "radius") return;
    setRadiusInput(String(analysis.radiusM));
    setRadiusInputError("");
  }, [analysis.radiusM, openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const activeMenu = openMenu;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      triggerRefs.current[activeMenu]?.focus();
      setOpenMenu(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!showCategories && openMenu === "category") setOpenMenu(null);
  }, [openMenu, showCategories]);

  function toggleMenu(menu: FilterMenu) {
    if (menu === "radius" && openMenu !== "radius") {
      setRadiusInput(String(analysis.radiusM));
      setRadiusInputError("");
    }
    setOpenMenu((current) => current === menu ? null : menu);
  }

  function patchAndClose(menu: FilterMenu, patch: Partial<AnalysisSettings>) {
    onChange(patch);
    triggerRefs.current[menu]?.focus();
    setOpenMenu(null);
  }

  async function handleCopyLink() {
    if (!onCopyLink) return;
    const ok = await onCopyLink();
    setCopyState(ok ? "copied" : "failed");
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }

  function handleDateChange(field: "startDate" | "endDate", value: string) {
    const next = { ...analysis, [field]: value };
    const error = analysisDateRangeError(next.startDate, next.endDate);
    if (error) {
      setDateInputError(error);
      return;
    }
    setDateInputError("");
    onChange({ [field]: value });
  }

  function applyDatePreset(preset: AnalysisDatePreset) {
    const window = analysisDatePresetWindow(preset, analysis.endDate);
    if (!window) {
      setDateInputError("Choose a valid end date before applying a preset.");
      return;
    }
    setDateInputError("");
    patchAndClose("dates", window);
  }

  function handleRadiusSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseAnalysisRadius(radiusInput);
    if (parsed.meters === null) {
      setRadiusInputError(parsed.error);
      return;
    }
    setRadiusInputError("");
    patchAndClose("radius", { radiusM: parsed.meters });
  }

  const datesUpdated = assistantUpdatedFields.includes("startDate")
    || assistantUpdatedFields.includes("endDate");

  return (
    <div className="mc-ctx" ref={rootRef}>
      <div className={`mc-ctx-summary${openMenu ? " is-open" : ""}`}>
        <div className="mc-ctx-summary-head">
          <span className="mc-ctx-summary-label">
            <svg className="mc-ctx-filter-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Tabby is using
          </span>
          {metadata ? <div className="mc-ctx-metadata">{metadata}</div> : null}
        </div>
        <p className="mc-ctx-guidance">Change a filter here or tell Tabby what to use.</p>

        {locationControls ? (
          <div className="mc-ctx-locations">
            <span className="mc-ctx-locations-label">Places</span>
            {locationControls}
          </div>
        ) : null}

        <div className="mc-ctx-summary-values" role="group" aria-label="Analysis filter controls">
          <div className="mc-ctx-filter-row">
          <div className={`mc-ctx-filter is-grow${datesUpdated ? " is-assistant-updated" : ""}`}>
            <button
              ref={(node) => { triggerRefs.current.dates = node; }}
              type="button"
              className="mc-ctx-filter-trigger"
              aria-label={`Date range: ${analysis.startDate} – ${analysis.endDate}`}
              aria-expanded={openMenu === "dates"}
              aria-haspopup="dialog"
              aria-controls="mc-ctx-dates-menu"
              aria-invalid={Boolean(dateError)}
              aria-describedby={dateError ? "mc-ctx-date-error" : undefined}
              onClick={() => toggleMenu("dates")}
            >
              <span>{analysis.startDate} – {analysis.endDate}</span>
              <Chevron open={openMenu === "dates"} />
            </button>
            {openMenu === "dates" ? (
              <div id="mc-ctx-dates-menu" className="mc-ctx-popover mc-ctx-date-popover" role="dialog" aria-modal="false" aria-labelledby="mc-ctx-dates-title">
                <strong id="mc-ctx-dates-title" className="mc-ctx-popover-title">Date range</strong>
                <div className="mc-ctx-presets" aria-label="Date presets">
                  <button type="button" onClick={() => applyDatePreset("30-days")}>Last 30 days</button>
                  <button type="button" onClick={() => applyDatePreset("90-days")}>Last 90 days</button>
                  <button type="button" onClick={() => applyDatePreset("year")}>This year</button>
                </div>
                <div className="mc-ctx-date-grid">
                  <label htmlFor="ctx-start-date">Start date</label>
                  <input id="ctx-start-date" type="date" className="mc-inp" value={analysis.startDate} min={ANALYSIS_MIN_DATE} max={analysis.endDate} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? "mc-ctx-date-error" : undefined} onChange={(event) => handleDateChange("startDate", event.target.value)} />
                  <label htmlFor="ctx-end-date">End date</label>
                  <input id="ctx-end-date" type="date" className="mc-inp" value={analysis.endDate} min={analysis.startDate > ANALYSIS_MIN_DATE ? analysis.startDate : ANALYSIS_MIN_DATE} max={latestAnalysisDate} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? "mc-ctx-date-error" : undefined} onChange={(event) => handleDateChange("endDate", event.target.value)} />
                </div>
              </div>
            ) : null}
          </div>

          <div className={`mc-ctx-filter is-align-end${assistantUpdatedFields.includes("radiusM") ? " is-assistant-updated" : ""}`}>
            <button
              ref={(node) => { triggerRefs.current.radius = node; }}
              type="button"
              className="mc-ctx-filter-trigger"
              aria-label={`Search radius: ${analysis.radiusM} m`}
              aria-expanded={openMenu === "radius"}
              aria-haspopup="dialog"
              aria-controls="mc-ctx-radius-menu"
              onClick={() => toggleMenu("radius")}
            >
              <span>{analysis.radiusM} m</span>
              <Chevron open={openMenu === "radius"} />
            </button>
            {openMenu === "radius" ? (
              <div id="mc-ctx-radius-menu" className="mc-ctx-popover" role="dialog" aria-modal="false" aria-labelledby="mc-ctx-radius-title">
                <strong id="mc-ctx-radius-title" className="mc-ctx-popover-title">Search radius</strong>
                <div className="mc-ctx-radius-suggestions" aria-label="Suggested radii">
                  {radii.map((value) => {
                    const selected = analysis.radiusM === value;
                    return (
                      <button key={value} type="button" className={`mc-ctx-option${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => patchAndClose("radius", { radiusM: value })}>
                        <span>{value} m</span>
                        {selected ? <Checkmark /> : null}
                      </button>
                    );
                  })}
                </div>
                <form className="mc-ctx-radius-custom" onSubmit={handleRadiusSubmit}>
                  <label htmlFor="mc-ctx-radius-input">Custom radius</label>
                  <div>
                    <input
                      id="mc-ctx-radius-input"
                      className="mc-inp"
                      value={radiusInput}
                      inputMode="decimal"
                      aria-invalid={Boolean(radiusInputError)}
                      aria-describedby="mc-ctx-radius-hint"
                      onChange={(event) => {
                        setRadiusInput(event.target.value);
                        if (radiusInputError) setRadiusInputError("");
                      }}
                    />
                    <button type="submit">Apply</button>
                  </div>
                  <small id="mc-ctx-radius-hint" className={radiusInputError ? "is-error" : undefined}>
                    {radiusInputError || "100 m–1 km · try 400 m, 0.4 km, or ¼ mile"}
                  </small>
                </form>
              </div>
            ) : null}
          </div>
          </div>

          <div className="mc-ctx-filter-row">
          {showCategories ? (
            <div className={`mc-ctx-filter is-category${assistantUpdatedFields.includes("offenseCategory") ? " is-assistant-updated" : ""}`}>
              <button
                ref={(node) => { triggerRefs.current.category = node; }}
                type="button"
                className="mc-ctx-filter-trigger"
                aria-label={`${analysis.layer === "arrests" ? "Arrest" : "Incident"} category: ${activeCategoryLabel}`}
                aria-expanded={openMenu === "category"}
                aria-haspopup="dialog"
                aria-controls="mc-ctx-category-menu"
                onClick={() => toggleMenu("category")}
              >
                <span>{activeCategoryLabel}</span>
                <Chevron open={openMenu === "category"} />
              </button>
              {openMenu === "category" ? (
                <div id="mc-ctx-category-menu" className="mc-ctx-popover" role="dialog" aria-modal="false" aria-labelledby="mc-ctx-category-title">
                  <strong id="mc-ctx-category-title" className="mc-ctx-popover-title">{analysis.layer === "arrests" ? "Arrest category" : "Incident category"}</strong>
                  <div className="mc-ctx-option-list">
                    {CATEGORIES.map((category) => {
                      const selected = analysis.offenseCategory === category.value;
                      const label = category.value ? category.label : categoryLabel("", analysis.layer);
                      return (
                        <button key={category.value || "all"} type="button" className={`mc-ctx-option${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => patchAndClose("category", { offenseCategory: category.value })}>
                          <span>{label}</span>
                          {selected ? <Checkmark /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={`mc-ctx-filter is-layer is-align-end is-grow${assistantUpdatedFields.includes("layer") ? " is-assistant-updated" : ""}`}>
            <button
              ref={(node) => { triggerRefs.current.layer = node; }}
              type="button"
              className="mc-ctx-filter-trigger"
              aria-label={`Data layer: ${incidentNoun(analysis.layer).pluralCap}`}
              aria-expanded={openMenu === "layer"}
              aria-haspopup="dialog"
              aria-controls="mc-ctx-layer-menu"
              onClick={() => toggleMenu("layer")}
            >
              <span>{incidentNoun(analysis.layer).pluralCap}</span>
              <Chevron open={openMenu === "layer"} />
            </button>
            {openMenu === "layer" ? (
              <div id="mc-ctx-layer-menu" className="mc-ctx-popover mc-ctx-layer-popover" role="dialog" aria-modal="false" aria-labelledby="mc-ctx-layer-title">
                <strong id="mc-ctx-layer-title" className="mc-ctx-popover-title">Data layer</strong>
                <div className="mc-ctx-option-list">
                  {LAYERS.map((option) => {
                    const selected = analysis.layer === option.value;
                    const unavailable = layerAvailability?.[option.value] === false;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`mc-ctx-option${selected ? " is-selected" : ""}`}
                        aria-pressed={selected}
                        disabled={unavailable}
                        aria-label={unavailable ? `${option.label} — No data loaded` : undefined}
                        onClick={() => patchAndClose("layer", { layer: option.value, offenseCategory: "" })}
                      >
                        <span>{option.label}</span>
                        {unavailable ? <small>No data</small> : selected ? <Checkmark /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          </div>
        </div>

        {dateError ? <p id="mc-ctx-date-error" className="mc-ctx-date-error" role="alert">{dateError}</p> : null}

        <div className="mc-ctx-actions">
          <button type="button" className="mc-link-copy" disabled={copyDisabled || !onCopyLink || !datesValid} onClick={() => void handleCopyLink()}>Copy link</button>
        </div>
      </div>

      <span className="mc-copy-status" data-testid="copy-status" role="status" aria-live="polite">
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy — try again." : ""}
      </span>
      {copyState === "copied" ? (
        <p className="mc-copy-hint">Link copied. It includes the exact locations, labels, and filters; anyone with the link can see them. Results recompute from fresh data.</p>
      ) : null}

      {disclosure ? <p className="mc-layer-note" role="note">{disclosure}</p> : null}
    </div>
  );
}
