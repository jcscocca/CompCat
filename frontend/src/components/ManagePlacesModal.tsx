import { useState } from "react";
import type { ReactNode } from "react";

import { BulkPlaceEntry } from "./BulkPlaceEntry";
import { Notice } from "./Notice";
import { PersonalUpload } from "./PersonalUpload";
import { PlaceForm } from "./PlaceForm";
import { incidentCountForPlace } from "../lib/incidentSummaries";
import { isSensitive } from "../lib/sensitivity";
import type { DashboardSummary, Place, PlaceCreate } from "../types";

export type ManageView = "manage" | "manual" | "import" | "upload";

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  summary: DashboardSummary | null;
  radiusM: number;
  addPinMode: boolean;
  search: ReactNode;
  initialView: ManageView;
  onStartAddPin: () => void;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onManualSubmit: (place: PlaceCreate) => Promise<void>;
  onImportSubmit: (csv: string) => Promise<void>;
  onUploaded?: () => void;
  onClose: () => void;
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
  summary,
  radiusM,
  addPinMode,
  search,
  initialView,
  onStartAddPin,
  onToggleSelect,
  onDelete,
  onManualSubmit,
  onImportSubmit,
  onUploaded,
  onClose,
}: Props) {
  const [view, setView] = useState<ManageView>(initialView);
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;

  return (
    <div className="mc-modal-scrim" role="dialog" aria-modal="true" aria-label={modalLabel(view)}>
      <div className="mc-modal">
        <div className="mc-modal-head">
          <h3>{modalLabel(view)}</h3>
          <button type="button" className="mc-iconbtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="mc-modal-tabs">
          <button type="button" className={`mc-modal-tab${view === "manage" ? " on" : ""}`} onClick={() => setView("manage")}>Manage</button>
          <button type="button" className={`mc-modal-tab${view === "manual" ? " on" : ""}`} onClick={() => setView("manual")}>Manual</button>
          <button type="button" className={`mc-modal-tab${view === "import" ? " on" : ""}`} onClick={() => setView("import")}>Bulk CSV</button>
          {onUploaded ? <button type="button" className={`mc-modal-tab${view === "upload" ? " on" : ""}`} onClick={() => setView("upload")}>Upload</button> : null}
        </div>
        {view === "manage" ? (
          <div className="mc-manage">
            <div className="mc-head-actions">
              <button type="button" className={`mc-tinybtn${addPinMode ? " on" : ""}`} onClick={onStartAddPin}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                {addPinMode ? "Click map..." : "Drop pin"}
              </button>
              {summary && summary.privacy.suppressed > 0 ? (
                <span className="cnt" title="Hidden from public exports">{summary.privacy.suppressed} hidden</span>
              ) : null}
            </div>
            {search}
            {places.length === 0 ? (
              <p className="mc-empty-list">No places yet. Choose <strong>Drop pin</strong> then click the map, or search for an address.</p>
            ) : (
              <ul className="mc-list" aria-label="Saved places">
                {places.map((place) => {
                  const selected = selectedIds.has(place.id);
                  const count = incidentCountForPlace(summary, place.id, radiusM);
                  const low = count === null && analyzedAtRadius && selected;
                  return (
                    <li key={place.id} className={`mc-card${selected ? " on" : ""}`}>
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
                        <div className="nm">{place.display_label}</div>
                        <div className="sub">{coords(place)}</div>
                        {isSensitive(place.sensitivity_class) ? (
                          <span className="cnt" title="Excluded from public CSV exports">Hidden from exports</span>
                        ) : null}
                      </div>
                      <div className="right">
                        {count !== null ? <span className="cnt">{count} {summary?.layer === "calls" ? "calls" : summary?.layer === "arrests" ? "arr." : "inc."}</span> : null}
                        {low ? <span className="cnt low">Low data</span> : null}
                        <button type="button" className="ico" aria-label={`Remove ${place.display_label}`} onClick={() => onDelete(place.id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mc-places-note"><Notice /></div>
          </div>
        ) : view === "manual" ? (
          <PlaceForm onSubmit={async (place) => { await onManualSubmit(place); setView("manage"); }} />
        ) : view === "import" ? (
          <BulkPlaceEntry onSubmit={async (csv) => { await onImportSubmit(csv); setView("manage"); }} />
        ) : (
          <PersonalUpload onUploaded={onUploaded ?? (() => {})} />
        )}
      </div>
    </div>
  );
}
