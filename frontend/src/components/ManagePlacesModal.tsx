import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { BulkPlaceEntry } from "./BulkPlaceEntry";
import { Notice } from "./Notice";
import { PersonalUpload } from "./PersonalUpload";
import { PlaceForm } from "./PlaceForm";
import { hasIncidentSummaryForAnalysis, incidentCountForPlace } from "../lib/incidentSummaries";
import { isSensitive } from "../lib/sensitivity";
import type { AnalysisSettings, DashboardSummary, Place, PlaceCreate } from "../types";

export type ManageView = "manage" | "manual" | "import" | "upload";

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  /** Full current analysis list, including ad-hoc coordinate ids. */
  analysisPlaceIds: Set<string>;
  summary: DashboardSummary | null;
  analysis: AnalysisSettings;
  addPinMode: boolean;
  search: ReactNode;
  initialView: ManageView;
  onStartAddPin: () => void;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  canClearAll: boolean;
  onClearAll: () => void;
  onManualSubmit: (place: PlaceCreate) => Promise<void>;
  onImportSubmit: (csv: string) => Promise<void>;
  onUploaded?: () => void;
  onClose: () => void;
  onRename: (id: string, label: string) => Promise<void>;
  /** Export privacy toggle: sensitivity_class normal ↔ suppress_from_public_export. */
  onToggleExport: (placeId: string, include: boolean) => void;
  exportHref: string;
};

function modalLabel(kind: ManageView): string {
  if (kind === "manage") return "Manage places";
  if (kind === "manual") return "Add a place manually";
  if (kind === "import") return "Import places";
  return "Upload location history";
}

function coords(place: Place): string {
  if (place.latitude === null || place.longitude === null) {
    return "No coordinates";
  }
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
}

function pinSvg(selected: boolean) {
  return (
    <svg width="15" height="20" viewBox="0 0 24 32">
      <path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill={selected ? "var(--accent)" : "#3A3F46"} />
      <circle cx="12" cy="11.5" r="4.4" fill="#fff" />
    </svg>
  );
}

export function ManagePlacesModal({
  places,
  selectedIds,
  analysisPlaceIds,
  summary,
  analysis,
  addPinMode,
  search,
  initialView,
  onStartAddPin,
  onToggleSelect,
  onDelete,
  canClearAll,
  onClearAll,
  onManualSubmit,
  onImportSubmit,
  onUploaded,
  onClose,
  onRename,
  onToggleExport,
  exportHref,
}: Props) {
  const [view, setView] = useState<ManageView>(
    initialView === "upload" && !onUploaded ? "manage" : initialView,
  );
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const analyzedInScope = hasIncidentSummaryForAnalysis(summary, analysis, analysisPlaceIds);
  const modalRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const renameActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const removeActionRefs = useRef(new Map<string, HTMLButtonElement>());
  // onClose is a fresh arrow each parent render; read it through a ref so the focus/trap effect
  // runs once on open (not on every render, which would steal focus back to the first control).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const availableViews: { view: ManageView; label: string }[] = [
    { view: "manage", label: "Manage" },
    { view: "manual", label: "Manual" },
    { view: "import", label: "Paste list" },
    ...(onUploaded ? [{ view: "upload" as const, label: "Upload" }] : []),
  ];

  function activateView(next: ManageView, moveFocus = false) {
    setView(next);
    setEditing(null);
    setConfirmingRemoveId(null);
    if (moveFocus) {
      tabsRef.current
        ?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)
        ?.focus();
    }
  }

  async function commitRename(id: string) {
    if (editing?.id !== id) return;
    const label = editing.value.trim();
    if (!label) return;
    await onRename(id, label);
    setEditing(null);
    window.setTimeout(() => renameActionRefs.current.get(id)?.focus(), 0);
  }

  function cancelRename(id: string) {
    setEditing(null);
    window.setTimeout(() => renameActionRefs.current.get(id)?.focus(), 0);
  }

  function cancelRemove(id: string) {
    setConfirmingRemoveId(null);
    window.setTimeout(() => removeActionRefs.current.get(id)?.focus(), 0);
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, current: ManageView) {
    const index = availableViews.findIndex((tab) => tab.view === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % availableViews.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + availableViews.length) % availableViews.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = availableViews.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    activateView(availableViews[nextIndex].view, true);
  }

  // Dialog accessibility: move focus into the dialog on open, trap Tab within it, close on
  // Escape, and restore focus to the trigger on close. Without this a keyboard/screen-reader
  // user tabs straight out to the map behind the "modal".
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
    // Runs once per open; onClose is read via ref (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="mc-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-places-title"
      onMouseDown={(event) => {
        // Dismiss only on a click of the scrim itself, never a click bubbling from the dialog.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mc-modal mc-manage-modal" ref={modalRef}>
        <div className="mc-modal-head">
          <h2 id="manage-places-title">{modalLabel(view)}</h2>
          <button type="button" className="mc-iconbtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="mc-modal-tabs" role="tablist" aria-label="Place management views" ref={tabsRef}>
          {availableViews.map((tab) => (
            <button
              key={tab.view}
              type="button"
              role="tab"
              id={`manage-places-tab-${tab.view}`}
              data-view={tab.view}
              aria-controls="manage-places-panel"
              aria-selected={view === tab.view}
              tabIndex={view === tab.view ? 0 : -1}
              className={`mc-modal-tab${view === tab.view ? " on" : ""}`}
              onClick={() => activateView(tab.view)}
              onKeyDown={(event) => onTabKeyDown(event, tab.view)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="manage-places-panel"
          aria-labelledby={`manage-places-tab-${view}`}
        >
          {view === "manage" ? (
            <div className="mc-manage">
            <div className="mc-head-actions">
              <button type="button" className={`mc-tinybtn${addPinMode ? " on" : ""}`} onClick={onStartAddPin}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                {addPinMode ? "Click map..." : "Drop pin"}
              </button>
              <button
                type="button"
                className="mc-tinybtn is-danger"
                disabled={!canClearAll}
                onClick={onClearAll}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                Clear all
              </button>
              {summary && summary.privacy.suppressed > 0 ? (
                <span className="cnt" title="Hidden from public exports">{summary.privacy.suppressed} hidden</span>
              ) : null}
            </div>
            {search}
            {places.length === 0 ? (
              <p className="mc-empty-list">No places yet. Choose <strong>Drop pin</strong> then click the map, or search for an address.</p>
            ) : (
              <>
                <p className="mc-manage-help">Choose saved places for analysis, rename them, or remove them from this session.</p>
                <ul className="mc-list" aria-label="Saved places">
                  {places.map((place) => {
                    const selected = selectedIds.has(place.id);
                    const count = incidentCountForPlace(summary, place.id, analysis, analysisPlaceIds);
                    const low = count === null && analyzedInScope && selected;
                    const confirmingRemove = confirmingRemoveId === place.id;
                    const editingPlace = editing?.id === place.id;
                    return (
                      <li
                        key={place.id}
                        className={`mc-card mc-place-card${selected ? " on" : ""}${editingPlace ? " is-editing" : ""}${confirmingRemove ? " is-confirming-remove" : ""}`}
                      >
                      <button
                        type="button"
                        className="chk"
                        role="checkbox"
                        aria-checked={selected}
                        aria-label={`Select ${place.display_label}`}
                        onClick={() => onToggleSelect(place.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
                      </button>
                      <span className="gly">{pinSvg(selected)}</span>
                      <div className="meta">
                        {editing?.id === place.id ? (
                          <>
                            <input
                              className="mc-rename-input"
                              aria-label={`New name for ${place.display_label}`}
                              aria-required="true"
                              aria-invalid={editing.value.trim() === ""}
                              aria-describedby={`rename-help-${place.id}`}
                              value={editing.value}
                              autoFocus
                              onChange={(e) => setEditing({ id: place.id, value: e.target.value })}
                              onKeyDown={async (e) => {
                                if (e.key === "Escape") {
                                  // Cancel the rename only; don't let the dialog's Escape close the modal.
                                  e.stopPropagation();
                                  cancelRename(place.id);
                                }
                                if (e.key === "Enter") {
                                  await commitRename(place.id);
                                }
                              }}
                            />
                            <p className="mc-sr" id={`rename-help-${place.id}`}>
                              Enter a name, or press Escape to cancel.
                            </p>
                          </>
                        ) : (
                          <div className="nm">{place.display_label}</div>
                        )}
                        <div className="sub">{coords(place)}</div>
                      </div>
                      <label className="mc-exp-toggle">
                        <input
                          type="checkbox"
                          checked={!isSensitive(place.sensitivity_class)}
                          aria-label={`Include ${place.display_label} in export`}
                          onChange={(event) => onToggleExport(place.id, event.target.checked)}
                        />
                        <span>Include in export</span>
                      </label>
                      <div className="right">
                        {count !== null ? <span className="cnt">{count} {analysis.layer === "calls" ? "calls" : analysis.layer === "arrests" ? "arr." : "inc."}</span> : null}
                        {low ? <span className="cnt low">Low data</span> : null}
                      </div>
                      <div className="mc-place-actions">
                        {editing?.id === place.id ? (
                          <>
                            <span className="mc-place-action-note">Save the new name or cancel.</span>
                            <button type="button" className="mc-place-action" onClick={() => cancelRename(place.id)}>Cancel</button>
                            <button
                              type="button"
                              className="mc-place-action is-primary"
                              disabled={!editing.value.trim()}
                              onClick={() => void commitRename(place.id)}
                            >
                              Save name
                            </button>
                          </>
                        ) : confirmingRemove ? (
                          <div
                            className="mc-remove-confirm"
                            role="group"
                            aria-label={`Confirm removal of ${place.display_label}`}
                            onKeyDown={(event) => {
                              if (event.key !== "Escape") return;
                              event.stopPropagation();
                              cancelRemove(place.id);
                            }}
                          >
                            <span className="mc-place-action-note">Remove <strong>{place.display_label}</strong> from this session?</span>
                            <button type="button" className="mc-place-action" autoFocus onClick={() => cancelRemove(place.id)}>Cancel</button>
                            <button
                              type="button"
                              className="mc-place-action is-danger"
                              onClick={() => {
                                setConfirmingRemoveId(null);
                                tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
                                onDelete(place.id);
                              }}
                            >
                              Remove place
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              ref={(node) => { if (node) renameActionRefs.current.set(place.id, node); else renameActionRefs.current.delete(place.id); }}
                              type="button"
                              className="mc-place-action"
                              aria-label={`Rename ${place.display_label}`}
                              onClick={() => { setConfirmingRemoveId(null); setEditing({ id: place.id, value: place.display_label }); }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z" /></svg>
                              Rename
                            </button>
                            <button
                              ref={(node) => { if (node) removeActionRefs.current.set(place.id, node); else removeActionRefs.current.delete(place.id); }}
                              type="button"
                              className="mc-place-action is-danger"
                              aria-label={`Remove ${place.display_label}`}
                              onClick={() => { setEditing(null); setConfirmingRemoveId(place.id); }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                    );
                  })}
                </ul>
              </>
            )}
            <p className="mc-places-expiry">Saved places last for this session (about a day). Keep a result with a share link.</p>
            <div className="mc-places-note"><Notice /></div>
            </div>
          ) : view === "manual" ? (
            <PlaceForm onSubmit={async (place) => { await onManualSubmit(place); activateView("manage"); }} />
          ) : view === "import" ? (
            <BulkPlaceEntry onSubmit={async (csv) => { await onImportSubmit(csv); activateView("manage"); }} />
          ) : (
            <PersonalUpload onUploaded={onUploaded ?? (() => {})} />
          )}
        </div>
        <div className="mc-modal-foot">
          <a className="mc-link-copy" href={exportHref}>Export session CSV</a>
          <p className="mc-export-note">Place summary for the current session.</p>
        </div>
      </div>
    </div>
  );
}
