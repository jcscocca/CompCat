import { useEffect, useRef } from "react";

import { REVISED_CAVEAT } from "../lib/layerCopy";

const REPO_URL = "https://github.com/jcscocca/CompCat";
const LICENSE_URL = "https://github.com/jcscocca/CompCat/blob/main/LICENSE";

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
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      aria-label="About CompCat"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mc-modal mc-about" ref={modalRef}>
        <div className="mc-modal-head">
          <h3>About CompCat</h3>
          <button type="button" className="mc-iconbtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <section className="mc-about-section">
          <h4>What this is</h4>
          <p>
            CompCat is a privacy-first tool for exploring reported Seattle Police Department
            (SPD) incident context around specific addresses. You give it places; it reports
            what was filed nearby, how that compares with the surrounding area, and how much
            of that comparison the data actually supports.
          </p>
          <p>{ABOUT_INVARIANT}</p>
          <p className="mc-about-byline">
            Built by Jacob Scocca ·{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
          </p>
        </section>

        <section className="mc-about-section">
          <h4>Scope</h4>
          <p>
            Seattle only. The incident data, the police-beat and neighborhood baselines, and
            the map itself all come from the City of Seattle, so the app stays locked to the
            city rather than implying coverage it does not have.
          </p>
          <p>
            Three layers: <strong>reported incidents</strong> (offenses reported to SPD),
            <strong> arrests</strong> (enforcement activity, logged where the arrest was made
            rather than where an offense occurred), and <strong>911 calls</strong> (requests
            for service, not confirmed incidents).
          </p>
        </section>

        <section className="mc-about-section">
          <h4>Data sources</h4>
          <p>
            Seattle Police Department (SPD) datasets published through the City of Seattle open
            data portal, used under the portal's public-domain terms.
          </p>
          <p>
            Basemap © OpenStreetMap contributors, rendered from Protomaps tiles. Both are
            served from this instance.
          </p>
          <p>
            The “Data through” pill in the header is the most recent date present in the loaded
            dataset — not today's date. SPD publishes on a lag, so the most recent weeks are
            usually still filling in.
          </p>
        </section>

        <section className="mc-about-section">
          <h4>What's stored</h4>
          <ul>
            <li>
              An anonymous session cookie lasts about 24 hours at a time and is renewed while
              you use the app, up to the instance's absolute session limit (currently about
              30 days). When that limit is reached, a new anonymous session starts, so saved
              places from the earlier session are no longer linked in this browser. There is
              no account, name, email, or personal identity.
            </li>
            <li>
              Server-side data for a session that goes quiet is automatically deleted after
              the retention window, currently about 30 days.
            </li>
            <li>Share links carry only coordinates rounded to about 110 m plus the analysis filters — no session id, no saved-place ids.</li>
            <li>
              Address lookup uses a server-side cache. It stores the normalized address you
              typed and the returned coordinates. The cache is shared across visitors and
              retained for about 30 days.
            </li>
            <li>
              Your browser does not contact third parties: map tiles, fonts, and address-search
              requests load from this server.
            </li>
            <li>
              The server sends address lookups to OpenStreetMap's Nominatim service. If you use
              the Analyst, the server sends place names and coordinates from the analysis
              context to the language-model provider that powers the Analyst.
            </li>
            <li>
              {personalUploadsEnabled
                ? "Personal location-history uploads are opt-in: nothing is uploaded unless you choose to, and you can delete what you uploaded at any time."
                : "Personal location-history uploads are disabled on this instance."}
            </li>
          </ul>
        </section>

        <section className="mc-about-section">
          <h4>Honest limits</h4>
          <p>{ABOUT_DATA_CAVEAT}</p>
          <p>
            The rate is a density per square kilometre per day, estimated over the selected
            window and scaled to the selected circle for display. It is not a per-person or
            per-visit rate.
          </p>
          <p>
            Results depend on the radius: a 250 m circle and a 1000 m circle measure different
            surrounding areas and can reasonably produce different results.
          </p>
          <p>
            Statistical adjustment covers the comparisons within one analysis run, not across
            the many filter, layer, or radius combinations someone may try.
          </p>
          <p>
            Intervals are approximate. Their coverage is near, not exactly, 95%, because
            report burstiness is estimated from a small number of months; very bursty,
            small-count results can be less reliable.
          </p>
          <p>
            This is a personal project on a small server: no accounts, no production
            authentication, and no encryption at rest.
          </p>
          <p>{ABOUT_RELIANCE_LIMIT}</p>
        </section>

        <section className="mc-about-section">
          <h4>License</h4>
          <p>
            <a href={LICENSE_URL} target="_blank" rel="noreferrer">MIT License</a> · © 2026 Jacob Scocca
          </p>
        </section>
      </div>
    </div>
  );
}
