import { useEffect, useRef } from "react";

import { REVISED_CAVEAT } from "../lib/layerCopy";

const REPO_URL = "https://github.com/jcscocca/CompCat";
const LICENSE_URL = "https://github.com/jcscocca/CompCat/blob/main/LICENSE";
const CRIME_DATA_URL =
  "https://data.seattle.gov/Public-Safety/SPD-Crime-Data-2008-Present/tazs-3rd5";
const ARREST_DATA_URL =
  "https://data.seattle.gov/Public-Safety/SPD-Arrest-Data/9bjs-7a7w";
const CALL_DATA_URL = "https://data.seattle.gov/Public-Safety/Call-Data/33kz-ixgy";

/**
 * The product invariant, stated for a first-time visitor. Exported because it is one of the
 * three fixed strings in this panel that legitimately carry safety/risk vocabulary — the
 * invariant sweep in AboutModal.test.tsx removes exactly these before checking the rest.
 */
export const ABOUT_INVARIANT =
  "CompCat reports reported incident context. It does not score safety, rank places as safe, unsafe, or dangerous, or claim that anyone was present at an incident.";

/** Second fixed caveat: what not to use CompCat for. See ABOUT_INVARIANT. */
export const ABOUT_RELIANCE_LIMIT =
  "Don't rely on CompCat for safety or legal decisions.";

/** Third fixed caveat: the shipped per-card caveat, restated here. See ABOUT_INVARIANT. */
export const ABOUT_DATA_CAVEAT = REVISED_CAVEAT;

/**
 * About / Privacy panel. Deliberately a clone of ManagePlacesModal's dialog behaviour
 * (focus in on open, Tab trap, Escape, focus restore, scrim-only dismiss) rather than a
 * new abstraction: two dialogs do not justify a shared primitive, and the pattern is
 * load-bearing for keyboard users.
 */
export function AboutModal({
  onClose,
  personalUploadsEnabled = false,
}: {
  onClose: () => void;
  /** Runtime state of `public_enable_personal_uploads`, read from the dashboard's
   * input-modes probe. The panel used to claim uploads were disabled unconditionally,
   * which is a lie on any instance that has them switched on. */
  personalUploadsEnabled?: boolean;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  // onClose is a fresh arrow each parent render; read it through a ref so the focus/trap
  // effect runs once on open (not on every render, which would steal focus back).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      aria-labelledby="about-compcat-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mc-modal mc-about" ref={modalRef}>
        <div className="mc-modal-head">
          <h2 id="about-compcat-title">About CompCat</h2>
          <button type="button" className="mc-iconbtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <section className="mc-about-section">
          <h3>What CompCat shows</h3>
          <p>
            CompCat shows reported Seattle Police Department activity near selected addresses.
            Choose places, dates, a radius, and a data layer to explore matching records.
          </p>
          <p>{ABOUT_INVARIANT}</p>
          <p className="mc-about-byline">
            Built by Jacob Scocca ·{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a> ·{" "}
            <a href={LICENSE_URL} target="_blank" rel="noreferrer">MIT License</a>
          </p>
        </section>

        <section className="mc-about-section">
          <h3>Data and freshness</h3>
          <p>
            Data comes from Seattle Open Data: <a href={CRIME_DATA_URL} target="_blank" rel="noreferrer">SPD Crime Data</a>,{" "}
            <a href={ARREST_DATA_URL} target="_blank" rel="noreferrer">SPD Arrest Data</a>, and{" "}
            <a href={CALL_DATA_URL} target="_blank" rel="noreferrer">Call Data</a>. For full
            definitions and metadata, refer to the linked dataset pages. Seattle refreshes these
            datasets daily.
          </p>
          <p>
            “Data through” is the newest event date loaded here. Updates are not live: CAD calls
            can lag by a few days, crime reports appear after approval, and source records can be
            corrected later.
          </p>
        </section>

        <section className="mc-about-section">
          <h3>Privacy</h3>
          <p>
            CompCat has no user accounts. Inactive session data and cached address searches are
            deleted after about 30 days. Share links include the places and filters you choose.
            Address searches use OpenStreetMap, and the Analyst sends analysis context to the
            configured language-model provider.{" "}
            {personalUploadsEnabled
              ? "Personal location-history uploads are opt-in and can be deleted at any time."
              : "Personal location-history uploads are disabled on this instance."}
          </p>
        </section>

        <section className="mc-about-section">
          <h3>Limits</h3>
          <p>{ABOUT_DATA_CAVEAT}</p>
          <p>This is a personal project on a small server. The database is not encrypted at rest.</p>
          <p>{ABOUT_RELIANCE_LIMIT}</p>
        </section>
      </div>
    </div>
  );
}
