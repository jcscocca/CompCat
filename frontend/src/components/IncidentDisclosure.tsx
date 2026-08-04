import { useEffect, useId, useRef, useState } from "react";

import type { IncidentNoun } from "../lib/layerCopy";

type Props = {
  returnedCount: number;
  totalCount: number;
  returnedLocationCount: number;
  totalLocationCount: number;
  unmappableCitywideCount: number;
  limit: number;
  itemNoun?: IncidentNoun;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const DEFAULT_NOUN: IncidentNoun = { singular: "incident", plural: "incidents", pluralCap: "Incidents" };

export function IncidentDisclosure({
  returnedCount,
  totalCount,
  returnedLocationCount,
  totalLocationCount,
  unmappableCitywideCount,
  limit,
  itemNoun = DEFAULT_NOUN,
}: Props) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const disclosureRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!disclosureRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  if (limit === 0) {
    return null; // nothing fetched yet
  }
  const truncated = totalLocationCount > returnedLocationCount;
  const locationLabel = `${fmt(totalLocationCount)} block location${totalLocationCount === 1 ? "" : "s"}`;
  const headline = totalCount === 0
    ? `No ${itemNoun.plural} in current map view`
    : `${fmt(totalCount)} ${totalCount === 1 ? itemNoun.singular : itemNoun.plural} across ${locationLabel} in current map view`;
  const stackDetail = totalCount === 0
    ? null
    : truncated
      ? `Map represents ${fmt(returnedCount)} records at ${fmt(returnedLocationCount)} block locations with the most recent records. Records mapped to the same block stay grouped.`
      : "Records mapped to the same block are shown as counted stacks.";
  const redactionDetail = unmappableCitywideCount > 0
    ? `+${fmt(unmappableCitywideCount)} citywide with redacted location — in beat stats only.`
    : null;
  const compactLabel = totalCount === 0
    ? `No ${itemNoun.plural} in view`
    : `${fmt(totalCount)} ${totalCount === 1 ? itemNoun.singular : itemNoun.plural} · ${fmt(totalLocationCount)} ${totalLocationCount === 1 ? "block" : "blocks"}`;
  const announcement = [headline, stackDetail, redactionDetail].filter(Boolean).join(" ");

  return (
    <div className="mc-disclosure" ref={disclosureRef}>
      <span className="mc-sr" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <button
        ref={toggleRef}
        type="button"
        className="mc-disclosure-summary"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={`${compactLabel}. ${open ? "Hide" : "Show"} map count details`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mc-disclosure-summary-text">{compactLabel}</span>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.6h.01" />
        </svg>
      </button>
      {open ? (
        <div id={detailsId} className="mc-disclosure-details" role="region" aria-label="Map count details">
          <strong>{headline}</strong>
          {stackDetail ? <p>{stackDetail}</p> : null}
          {redactionDetail ? <p>{redactionDetail}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
