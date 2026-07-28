# Public instance — Slice 2 (Trust surface & link polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a stranger who clicks a shared CompCat link everything they need to trust the app: an in-app About/Privacy modal reachable from the topbar, real link metadata (favicon, OG card, manifest, theme-color), honest ephemerality hints where places are saved and links are copied, and the professionalism nits from the 2026-07-27 review (error-copy hygiene, one export label, pinch-zoom, SPD/NIBRS glosses).

**Architecture:** Frontend only; **no `app/` change of any kind**. One new component (`AboutModal.tsx`) reusing `ManagePlacesModal`'s focus-trap/Escape/aria pattern verbatim, mounted from `MapWorkspace` beside the existing manage modal; one new static-asset set under `frontend/public/assets/` (the only public sub-path the FastAPI server actually mounts — see wire facts); a status→copy mapping inside `api/client.ts`'s `request()` so no thrown `Error.message` can ever carry a server body; and small in-place copy/label edits in five existing components.

**Tech Stack:** React 19 + TypeScript + Vite 7, Vitest 3 (`npx vitest run --environment jsdom`), `npm run lint` = `tsc -b --pretty false`. Frontend commands run from `frontend/`. PNG rasterization uses `@resvg/resvg-js`, already a `frontend/` devDependency (`frontend/package.json:32`).

**Working context:** Worktree `/Users/jscocca/Repos/compcat/.worktrees/p8-slice2-trust-surface`, branch `p8-slice2-trust-surface`. Spec: `docs/superpowers/specs/2026-07-27-public-instance-slice2-trust-surface-design.md` (committed at `8bc57c5`). Frontend tests run from `frontend/` via `npx vitest run <paths> --environment jsdom`. The gate is `make test-all` from the **worktree root** (pytest + ruff + `npm test` + `npm run build`). Baseline green at plan time.

**Standing rule (product invariant):** CompCat reports *reported incident context*. New user-facing copy must not score safety, rank places safe/unsafe/dangerous, or claim presence at an incident. The About panel is the one place that **states** the invariant, so it necessarily contains the words `safety`/`safe`/`unsafe`/`dangerous`/`risk` inside fixed, exported caveat constants — Task 9 pins that those constants are the *only* place those words appear.

---

## Verified wire facts this plan relies on

Read from the branch at plan time; line numbers are branch HEAD (`8bc57c5`).

**Topbar & theme toggle**
- `frontend/src/components/MapWorkspace.tsx:792-804` — `<header className="mc-topbar">` holds `.mc-brand` (logo + wordmark) and `.mc-topbar-right`. `.mc-topbar-right` renders `{!isMobile ? layerControls : null}`, `{!isMobile ? <div className="mc-status">…</div> : null}`, then `<ThemeToggle theme={theme} onChange={setTheme} />` **unconditionally**. Anything added to `.mc-topbar-right` outside an `isMobile` guard therefore appears at both breakpoints for free.
- `frontend/src/components/ThemeToggle.tsx:5-22` — a 32 px round icon button: `className="mc-themetoggle"`, `aria-label={`Switch to ${next} theme`}`, inline `viewBox="0 0 24 24"` stroke SVG at `width="15" height="15"`. Copy this shape for the ⓘ button.
- `frontend/src/styles/mapWorkspace.css:58-61` — `.mc-themetoggle{display:grid;place-items:center;width:32px;height:32px;border-radius:999px;cursor:pointer;color:var(--text-strong);background:var(--surface);border:1px solid var(--border);}` + `:hover` + `.mc-topbar-right{display:flex;align-items:center;gap:10px;}`.
- `isMobile` is `window.innerWidth <= MOBILE_MAX_WIDTH`, recomputed every render (`MapWorkspace.tsx:650`).

**Modal pattern to reuse (do not invent a new one)**
- `frontend/src/components/ManagePlacesModal.tsx:80-127` — `modalRef` on the inner `.mc-modal`; `onCloseRef` holds the latest `onClose` so the effect can run **once on open** (`[]` deps, with the `react-hooks/exhaustive-deps` disable comment); the effect captures `document.activeElement`, focuses `focusable()[0]`, adds a `document` `keydown` listener that (a) `preventDefault()`s Escape and calls `onCloseRef.current()`, (b) wraps Tab/Shift-Tab between first and last focusable, and on cleanup removes the listener and restores focus to the previously-focused element. `focusable()` = `modalRef.current?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')` filtered by `el.offsetParent !== null`.
- `ManagePlacesModal.tsx:129-146` — outer `<div className="mc-modal-scrim" role="dialog" aria-modal="true" aria-label={…}>` with an `onMouseDown` that closes only when `event.target === event.currentTarget`; inner `<div className="mc-modal" ref={modalRef}>` containing `.mc-modal-head` (`<h3>` + `.mc-iconbtn` close button with `aria-label="Close"` and the 12×12 ✕ path `M6 6l12 12M18 6L6 18`).
- CSS already present: `.mc-modal-scrim` (`mapWorkspace.css:341`, `z-index:1300`), `.mc-modal` (`:342`, `width:min(560px,100%);max-height:90vh;overflow:auto`), `.mc-modal-head` (`:343`), `.mc-iconbtn` (`:348`), `.mc-modal-foot` (`:247`).

**API client error path**
- `frontend/src/api/client.ts:57-77` — `request<T>()` does a bare `await fetch(...)` then, on `!response.ok`, `const text = await response.text(); throw new Error(text || \`Request failed with status ${response.status}\`)`. **The raw body is the thrown message today.**
- `frontend/src/api/client.ts:118-126` — `uploadPersonalData()` bypasses `request()` with its own `fetch("/uploads")` and throws `(await response.text()) || \`Upload failed (${response.status})\``. Same leak.
- Only surfacer of a thrown message today: `frontend/src/components/PersonalUpload.tsx:23` and `:36` (`error instanceof Error ? error.message : …`). `frontend/src/lib/useTrends.ts:50` and `frontend/src/lib/useIncidentPoints.ts:108` also store `cause.message`, but neither value is rendered (`TrendSection.tsx` never reads `.error`; `MapWorkspace.tsx:826,896` render only `data.error`, which is set from static strings). `frontend/src/lib/useAssistantTurn.ts:104-109` catches with static constants (`OFFLINE_MESSAGE` / `COMMAND_FAILURE_MESSAGE`) and never uses the thrown message — the SSE path is out of scope and already safe.
- Existing client tests that **must be replaced** (they assert the raw-body behaviour): `frontend/src/api/client.test.ts:63-67` ("throws response text when a request fails") and `:69-73` ("throws a status fallback…"). Tests mock via `vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(...))`.
- Existing 429 copy comes from the backend and is the wording to keep: `app/ratelimit.py:163` → `{"detail": "Request limit reached — please retry shortly."}`.

**Share-link copy toast**
- `frontend/src/components/ContextStrip.tsx:37-47` — `copyState: "idle" | "copied" | "failed"` with a 2000 ms reset; `:121-128` renders the actions row (`Run analysis` / `Copy link` / `Done`) followed by `<span className="mc-copy-status" data-testid="copy-status" role="status" aria-live="polite">{copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy — try again." : ""}</span>`. **This is the share-toast location.**
- The URL is built in `MapWorkspace.tsx:550-559` (`buildShareUrl`) — points are `Number(e.latitude.toFixed(3))`, i.e. 3 decimal degrees ≈ **110 m** generalization, which is exactly the About claim.
- Existing tests to keep green: `ContextStrip.test.tsx:95-118` assert `findByText("Copied")`, `findByText("Couldn't copy — try again.")`, and that the region is empty at rest — so the new hint must be a **sibling node**, not appended to the same text node.

**Manage-places dialog**
- `ManagePlacesModal.tsx:237` — `<div className="mc-places-note"><Notice /></div>` is the existing bottom-of-list note slot in the `manage` view. `Notice.tsx` renders `<section className="notice" aria-label="Important data note">` whose text contains "not safety advice" — the ephemerality note must be a separate element (and any sweep must stay scoped to About).

**Export labels**
- `frontend/src/components/AnalysisCard.tsx:79-80` — `<a className="mc-result-export" href={…} download>Export CSV</a>` — **already the target label; no change needed.**
- `frontend/src/components/ManagePlacesModal.tsx:246-248` — `<div className="mc-modal-foot"><a className="mc-link-copy" href={exportHref}>Download Tableau CSV</a></div>` — **this is the only label to unify.**

**index.html and static serving**
- `frontend/index.html` (whole file, 12 lines): `<meta charset="UTF-8" />`, then `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />`, then `<title>CompCat</title>`. No other head content.
- `frontend/tests/indexHtml.test.ts` already exists (`@vitest-environment node`, reads the file with `readFileSync`) and asserts: **no `https?://` host appears anywhere in index.html**, no Google Fonts, and the viewport keeps `viewport-fit=cover`. New meta must therefore use **root-relative** URLs only.
- `frontend/vite.config.ts:47-49` — `build.outDir = "../app/static/dashboard"`, `emptyOutDir: true`. Vite copies `frontend/public/**` verbatim into that outDir. `app/static/dashboard/` is gitignored (`.gitignore:14`).
- **`app/main.py:28-59` mounts only three sub-paths** — `/assets` (from `static_dir/assets`), `/basemaps-assets`, `/fonts` — plus `GET /` and `GET /dashboard-app/{path}` returning `index.html`. A file dropped at `frontend/public/favicon.svg` would land at `app/static/dashboard/favicon.svg` and **404 in production**. `frontend/public/fonts/` (the only existing public sub-dir, `frontend/public/fonts/*.woff2`) works precisely because `/fonts` is mounted, and `app/main.py:39-41` documents this exact gotcha for `basemaps-assets`. **Therefore every new static file in this slice goes under `frontend/public/assets/` and is referenced as `/assets/…`.** Spec forbids backend changes, so this is the only frontend-only path that works.

**Brand mark to derive the favicon from**
- `MapWorkspace.tsx:793-798` — `.mc-brand > .mc-logo` is a 30 px rounded square (`mapWorkspace.css:52`: `width:30px;height:30px;border-radius:9px;background:var(--accent)`) wrapping a 16 px `viewBox="0 0 24 24"` SVG:
  - head path `d="M4 9 L4 4 L9 7 Q12 6 15 7 L20 4 L20 9 Q21.5 11.5 21.5 14 Q21.5 20 12 20 Q2.5 20 2.5 14 Q2.5 11.5 4 9 Z"` filled `var(--on-accent)`
  - eyes `<circle cx="8.5" cy="13" r="1.3" />` and `<circle cx="15.5" cy="13" r="1.3" />` filled `var(--accent)`
- Theme tokens (`mapWorkspace.css:4-9` light, `:649-657` dark): light `--accent:#0F6E56`, `--on-accent:#fff`, `--surface:#FFFFFF`; dark `--surface:#1A222B`, `--accent:#3FBF8F`. Favicon uses the **light** pair (`#0F6E56` ground, `#FFFFFF` cat) — it reads on both browser chromes. `theme-color` uses `#FFFFFF` / `#1A222B`.
- `scripts/render_ios_icon.mjs` is the working precedent for rasterizing brand SVG with resvg from repo-root `scripts/`: it uses `createRequire(join(frontendDir, "package.json"))` because `@resvg/resvg-js` only exists under `frontend/node_modules`.
- OG source image: `docs/images/dashboard-night.png`, **1440×900** (verified with `sips`), referenced by `README.md:26`.

**Invariant sweep pattern (there is no single sweep file — it is a per-component test)**
- The pattern, verbatim, in `CompareVerdict.test.tsx:41-50`, `PlaceContextCard.test.tsx:112-118`, `CompareRankedList.test.tsx:45-51`, `CompareRateNumberLine.test.tsx:67-73`:
  ```ts
  const text = (<scoped node>.textContent ?? "").toLowerCase();
  for (const banned of ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"]) {
    expect(text).not.toContain(banned);
  }
  ```
- Existing sweeps stay clean by **scoping to a region that excludes the fixed caveat** (e.g. `screen.getByTestId("compare-callout")`), because the fixed caveat legitimately contains `risk`: `frontend/src/lib/layerCopy.ts:35-36` exports `REVISED_CAVEAT = "Reported incident context, not a personal risk prediction. Results use reported Seattle incident data, which can be incomplete, delayed, corrected, or geographically generalized."` (asserted by `AnalysisCard.test.tsx:203-210`).
- The About panel cannot be region-scoped away from its own invariant statement, so Task 9 **mirrors that allowance explicitly**: the fixed constants are removed from the swept text first, then the same banned list runs over what is left.

**Freshness / NIBRS / methods**
- `frontend/src/components/DataFreshness.tsx:35-36` — `const noun = layer === "calls" ? "911 calls" : layer === "arrests" ? "SPD arrests" : "reported SPD incidents";` used in the `title` tooltip detail (`:46-53`) and in the "No {noun} data loaded" line (`:44`). The tooltip is the first-use site the spec names.
- `frontend/src/components/IncidentDetailsSection.tsx:9-12` — `incidentSubtypeLabel()` returns the bare string `` `NIBRS ${incident.nibrs_group}` ``; rendered at `:80` (table `<td>`) and `:123` (card `<span>`). No test file exists for this component yet.
- `frontend/src/lib/methodsDefinitions.ts:10-41` — `METHODS_DEFINITIONS: MethodDefinition[]`, each `{ id, term, shownAs, plain, howToRead, formula? }`; rendered by `MethodsAppendix.tsx:18-26`. Last entry is `exactPValue`.

**Facts the About copy asserts (all verified)**
- Session cookie TTL: `app/sessions.py:12` — `SESSION_MAX_AGE_SECONDS = 60 * 60 * 24` (24 h).
- Basemap attribution: `frontend/src/lib/mapStyle.ts:19` — `© OpenStreetMap contributors · Protomaps`.
- Personal uploads default off: `frontend/src/lib/useDashboardData.ts:39` — `useState(false)`; the Upload tab only renders when `onUploaded` is passed (`ManagePlacesModal.tsx:151`), which `MapWorkspace.tsx:926` gates on `data.personalUploadsEnabled`.
- Repo URL: `README.md:3` — `https://github.com/jcscocca/CompCat`. License: `LICENSE` line 1 — `MIT License`, `Copyright (c) 2026 Jacob Scocca`.

---

## Task 1: `AboutModal` + the topbar ⓘ button

**Files:**
- Create: `frontend/src/components/AboutModal.tsx`
- Create: `frontend/src/components/AboutModal.test.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx`
- Modify: `frontend/src/components/MapWorkspace.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [x] **Step 1: Write the failing component test**

Create `frontend/src/components/AboutModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AboutModal } from "./AboutModal";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

describe("AboutModal", () => {
  it("renders a labelled modal dialog with every section", () => {
    render(<AboutModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "About CompCat" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const heading of [
      "What this is",
      "Scope",
      "Data sources",
      "What's stored",
      "Honest limits",
      "License",
    ]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("states the product invariant verbatim and credits the operator", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(
      screen.getByText(/does not score safety, rank places as safe, unsafe, or dangerous/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Built by Jacob Scocca/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/jcscocca/CompCat",
    );
  });

  it("names the data sources, the basemap attribution, and the freshness pill", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/Seattle Police Department \(SPD\) datasets/)).toBeInTheDocument();
    expect(screen.getByText(/City of Seattle open data portal/)).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByText(/Protomaps/)).toBeInTheDocument();
    expect(screen.getByText(/“Data through”/)).toBeInTheDocument();
  });

  it("spells out what is stored, including the 24-hour session and 110 m share links", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/anonymous session cookie that lasts about 24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/expire with it/i)).toBeInTheDocument();
    expect(screen.getByText(/about 110 m/)).toBeInTheDocument();
    expect(screen.getByText(/No third-party requests/i)).toBeInTheDocument();
    expect(screen.getByText(/uploads are disabled on this instance/i)).toBeInTheDocument();
  });

  it("states the honest limits and links the MIT licence", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/incomplete, delayed, corrected, or geographically generalized/)).toBeInTheDocument();
    expect(screen.getByText(/no accounts, no production authentication, and no encryption at rest/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MIT License" })).toHaveAttribute(
      "href",
      "https://github.com/jcscocca/CompCat/blob/main/LICENSE",
    );
  });

  it("moves focus into the dialog on open and restores it on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<AboutModal onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(trigger);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes on Escape, on the close button, and on a scrim click but not a body click", () => {
    const onClose = vi.fn();
    const { container } = render(<AboutModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(container.querySelector(".mc-modal")!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(container.querySelector(".mc-modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("traps Tab between the first and last focusable controls", () => {
    render(<AboutModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    expect(items.length).toBeGreaterThan(1);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/AboutModal.test.tsx --environment jsdom`
Expected: FAIL — `Failed to resolve import "./AboutModal"`.

- [x] **Step 3: Create `frontend/src/components/AboutModal.tsx`**

Note the three exported constants: they are the *only* strings in this file carrying invariant vocabulary, and Task 9 strips exactly them before sweeping. `REVISED_CAVEAT` is imported rather than restated so the "Honest limits" wording stays identical to the one printed on every expanded card.

```tsx
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
export function AboutModal({ onClose }: { onClose: () => void }) {
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
            Seattle only. The incident data, the police-beat and neighbourhood baselines, and
            the map itself all come from the City of Seattle, so the app stays locked to the
            city rather than implying coverage it does not have.
          </p>
          <p>
            Three layers: <strong>reported incidents</strong> (offences reported to SPD),
            <strong> arrests</strong> (enforcement activity, logged where the arrest was made
            rather than where an offence occurred), and <strong>911 calls</strong> (requests
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
            <li>An anonymous session cookie that lasts about 24 hours. No name, no email, no account — just an opaque session id.</li>
            <li>Places you save belong to that session and expire with it. Nothing about you survives it.</li>
            <li>Share links carry only coordinates rounded to about 110 m plus the analysis filters — no session id, no saved-place ids.</li>
            <li>No third-party requests: map tiles, fonts, and address search are all served from this instance.</li>
            <li>Personal location-history uploads are disabled on this instance.</li>
          </ul>
        </section>

        <section className="mc-about-section">
          <h4>Honest limits</h4>
          <p>{ABOUT_DATA_CAVEAT}</p>
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
```

- [x] **Step 4: Add the About panel styles**

In `frontend/src/styles/mapWorkspace.css`, immediately after the `.mc-modal-foot{…}` rule (currently line 247), append:

```css
.mc-about-section{margin-bottom:14px;}
.mc-about-section h4{margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--text-dim);}
.mc-about-section p{margin:0 0 8px;font-size:13px;line-height:1.55;color:var(--text);}
.mc-about-section ul{margin:0;padding-left:18px;display:grid;gap:6px;font-size:13px;line-height:1.5;color:var(--text);}
.mc-about-section a{color:var(--accent);}
.mc-about-byline{color:var(--text-strong);font-weight:500;}
```

- [x] **Step 5: Run the component test**

Run: `cd frontend && npx vitest run src/components/AboutModal.test.tsx --environment jsdom`
Expected: PASS (8 tests).

- [x] **Step 6: Add the failing topbar test**

In `frontend/src/components/MapWorkspace.test.tsx`, add inside the existing `describe("MapWorkspace", …)` block:

```tsx
  it("opens the About panel from the topbar and closes it on Escape", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    expect(screen.queryByRole("dialog", { name: "About CompCat" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About CompCat" }));
    expect(screen.getByRole("dialog", { name: "About CompCat" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "About CompCat" })).not.toBeInTheDocument();
  });

  it("narrow viewport: the About button stays in the topbar beside the theme toggle", async () => {
    window.innerWidth = 375;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    const { container } = render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    const right = container.querySelector(".mc-topbar-right")!;
    expect(within(right as HTMLElement).getByRole("button", { name: "About CompCat" })).toBeInTheDocument();
    expect(within(right as HTMLElement).getByRole("button", { name: /Switch to .* theme/ })).toBeInTheDocument();
  });
```

(`render`, `screen`, `fireEvent`, `within`, `vi` are already imported at the top of that file; `makeSummary` is already defined there. The suite's `afterEach` already resets `window.innerWidth = 1024`.)

- [x] **Step 7: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/MapWorkspace.test.tsx --environment jsdom -t "About"`
Expected: FAIL — no button named "About CompCat".

- [x] **Step 8: Wire the button and modal into `MapWorkspace.tsx`**

1. Add the import next to the other component imports (alphabetical block starting `import { AssistantPanel } from "./AssistantPanel";` at line 31):

```tsx
import { AboutModal } from "./AboutModal";
```

(place it directly above the `AssistantPanel` import so the block stays alphabetical.)

2. Add state next to the other modal state (`const [managePlaces, setManagePlaces] = useState<ManageView | null>(null);`, line 63):

```tsx
  const [aboutOpen, setAboutOpen] = useState(false);
```

3. In the topbar, replace the `.mc-topbar-right` block (lines 799-803) with:

```tsx
          <div className="mc-topbar-right">
            {!isMobile ? layerControls : null}
            {!isMobile ? <div className="mc-status"><span className="dot" />Public session - Seattle</div> : null}
            <button
              type="button"
              className="mc-aboutbtn"
              aria-label="About CompCat"
              title="About CompCat"
              onClick={() => setAboutOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6h.01" /></svg>
            </button>
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
```

4. Mount the modal as a sibling of the manage modal — immediately **after** the `{managePlaces ? (…) : null}` block and before the closing `</div>` of `.mc-frame` (currently line 940):

```tsx
        {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}
```

- [x] **Step 9: Share the icon-button styling**

In `frontend/src/styles/mapWorkspace.css`, change the two `.mc-themetoggle` selectors (lines 58 and 60) to also cover the new button:

```css
.mc-themetoggle,.mc-aboutbtn{display:grid;place-items:center;width:32px;height:32px;border-radius:999px;cursor:pointer;
  color:var(--text-strong);background:var(--surface);border:1px solid var(--border);}
.mc-themetoggle:hover,.mc-aboutbtn:hover{border-color:var(--border-strong);}
```

- [x] **Step 10: Run both suites**

Run: `cd frontend && npx vitest run src/components/AboutModal.test.tsx src/components/MapWorkspace.test.tsx --environment jsdom`
Expected: PASS — 8 new AboutModal tests, 2 new MapWorkspace tests, every pre-existing MapWorkspace test unchanged and green.

- [x] **Step 11: Lint**

Run: `cd frontend && npm run lint`
Expected: clean.

- [x] **Step 12: Commit**

```bash
git add frontend/src/components/AboutModal.tsx frontend/src/components/AboutModal.test.tsx frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(about): in-app About/Privacy panel behind a topbar info button"
```

---

## Task 2: Brand favicon set, OG card, and web manifest

Every file lands in `frontend/public/assets/` because `/assets` is the only public sub-path the server mounts (see wire facts — `app/main.py:34-36`).

**Files:**
- Create: `frontend/public/assets/favicon.svg`
- Create: `frontend/public/assets/site.webmanifest`
- Create: `scripts/render_favicons.mjs`
- Create (generated): `frontend/public/assets/favicon-32.png`, `frontend/public/assets/apple-touch-icon.png`
- Create (copied): `frontend/public/assets/og-card.png`

- [x] **Step 1: Author the SVG favicon from the brand mark**

Create `frontend/public/assets/favicon.svg`. The 24-unit brand art (`MapWorkspace.tsx:795`) is placed on a 32-unit rounded square — `rx="9"` and the accent ground mirror `.mc-logo` (`mapWorkspace.css:52`), with the art inset 4 units per side so it stays legible at 16 px:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="9" fill="#0F6E56"/>
  <g transform="translate(4 4)">
    <path d="M4 9 L4 4 L9 7 Q12 6 15 7 L20 4 L20 9 Q21.5 11.5 21.5 14 Q21.5 20 12 20 Q2.5 20 2.5 14 Q2.5 11.5 4 9 Z" fill="#FFFFFF"/>
    <circle cx="8.5" cy="13" r="1.3" fill="#0F6E56"/>
    <circle cx="15.5" cy="13" r="1.3" fill="#0F6E56"/>
  </g>
</svg>
```

- [x] **Step 2: Write the raster script**

Create `scripts/render_favicons.mjs` — same `createRequire` trick as `scripts/render_ios_icon.mjs` because `@resvg/resvg-js` lives under `frontend/node_modules`:

```js
// Renders the PNG favicon fallbacks from the CompCat brand cat mark
// (the .mc-logo glyph in frontend/src/components/MapWorkspace.tsx).
// Usage: node scripts/render_favicons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, "..", "frontend");
const require = createRequire(join(frontendDir, "package.json"));
const { Resvg } = require("@resvg/resvg-js");

// Light-theme brand pair (--accent / --on-accent): reads on light and dark browser chrome.
const BG = "#0F6E56";
const FG = "#FFFFFF";

const HEAD = `<path d="M4 9 L4 4 L9 7 Q12 6 15 7 L20 4 L20 9 Q21.5 11.5 21.5 14 Q21.5 20 12 20 Q2.5 20 2.5 14 Q2.5 11.5 4 9 Z" fill="${FG}"/>`
  + `<circle cx="8.5" cy="13" r="1.3" fill="${BG}"/>`
  + `<circle cx="15.5" cy="13" r="1.3" fill="${BG}"/>`;

// Same 32-unit composition as public/assets/favicon.svg. iOS masks the touch icon itself,
// so that variant is a full-bleed square (rounded corners there would double up).
function mark(rounded) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`
    + `<rect width="32" height="32"${rounded ? ' rx="9"' : ""} fill="${BG}"/>`
    + `<g transform="translate(4 4)">${HEAD}</g></svg>`;
}

function render(svg, width, path) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

const out = join(frontendDir, "public", "assets");
mkdirSync(out, { recursive: true });
render(mark(true), 32, join(out, "favicon-32.png"));
render(mark(false), 180, join(out, "apple-touch-icon.png"));
```

- [x] **Step 3: Generate the PNGs and copy the OG card**

Run from the worktree root:

```bash
cd frontend && npm install && cd ..
node scripts/render_favicons.mjs
cp docs/images/dashboard-night.png frontend/public/assets/og-card.png
```

Expected: two `wrote …` lines (a few hundred bytes for the 32 px, a few KB for the 180 px), and `frontend/public/assets/` holding `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `og-card.png`.

Verify: `file frontend/public/assets/*.png` → `PNG image data, 32 x 32`, `PNG image data, 180 x 180`, `PNG image data, 1440 x 900`.

- [x] **Step 4: Write the web manifest**

Create `frontend/public/assets/site.webmanifest`:

```json
{
  "name": "CompCat",
  "short_name": "CompCat",
  "description": "Explore reported Seattle SPD incident context around addresses — not a safety score.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#1A222B",
  "theme_color": "#1A222B",
  "icons": [
    { "src": "/assets/favicon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "/assets/favicon-32.png", "sizes": "32x32", "type": "image/png" },
    { "src": "/assets/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```

- [x] **Step 5: Confirm the build actually places them under the mounted path**

Run from the worktree root:

```bash
cd frontend && npm run build && cd ..
ls -1 app/static/dashboard/assets/ | grep -E 'favicon|apple-touch|og-card|webmanifest'
```

Expected: all five filenames listed (`favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `og-card.png`, `site.webmanifest`) alongside Vite's hashed bundles. If Vite warns about a public-file name colliding with an emitted chunk, rename the offending file — do **not** move the directory, because `/assets` is the only mount.

- [x] **Step 6: Commit the assets**

```bash
git add frontend/public/assets scripts/render_favicons.mjs
git commit -m "feat(brand): favicon set, OG card, and web manifest under the mounted /assets path"
```

---

## Task 3: `index.html` head — description, OG, Twitter, theme-color, icons, manifest

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/tests/indexHtml.test.ts`

- [x] **Step 1: Add the failing head tests**

In `frontend/tests/indexHtml.test.ts`, append these two describe blocks after the existing `describe("index.html privacy guard", …)`:

```ts
const DESCRIPTION =
  "Explore reported Seattle SPD incident context around addresses — not a safety score.";

function metaContent(attr: "name" | "property", value: string): string[] {
  const pattern = new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*>`, "gi");
  return (html.match(pattern) ?? []).map(
    (tag) => /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "",
  );
}

describe("index.html link metadata", () => {
  it("carries the invariant-safe description", () => {
    expect(metaContent("name", "description")).toEqual([DESCRIPTION]);
  });

  it("carries an Open Graph card pointing at the static OG image", () => {
    expect(metaContent("property", "og:type")).toEqual(["website"]);
    expect(metaContent("property", "og:title")[0]).toMatch(/CompCat/);
    expect(metaContent("property", "og:description")).toEqual([DESCRIPTION]);
    expect(metaContent("property", "og:image")).toEqual(["/assets/og-card.png"]);
    expect(metaContent("property", "og:image:width")).toEqual(["1440"]);
    expect(metaContent("property", "og:image:height")).toEqual(["900"]);
  });

  it("carries a large-image twitter card", () => {
    expect(metaContent("name", "twitter:card")).toEqual(["summary_large_image"]);
    expect(metaContent("name", "twitter:image")).toEqual(["/assets/og-card.png"]);
  });

  it("declares a theme-color for both schemes", () => {
    const tags = html.match(/<meta[^>]*name=["']theme-color["'][^>]*>/gi) ?? [];
    expect(tags).toHaveLength(2);
    expect(tags.join(" ")).toMatch(/\(prefers-color-scheme: light\)/);
    expect(tags.join(" ")).toMatch(/\(prefers-color-scheme: dark\)/);
    expect(tags.join(" ")).toMatch(/#FFFFFF/);
    expect(tags.join(" ")).toMatch(/#1A222B/);
  });

  it("links the favicon set and the web manifest", () => {
    expect(html).toMatch(/rel=["']icon["'][^>]*href=["']\/assets\/favicon\.svg["']/);
    expect(html).toMatch(/rel=["']icon["'][^>]*href=["']\/assets\/favicon-32\.png["']/);
    expect(html).toMatch(/rel=["']apple-touch-icon["'][^>]*href=["']\/assets\/apple-touch-icon\.png["']/);
    expect(html).toMatch(/rel=["']manifest["'][^>]*href=["']\/assets\/site\.webmanifest["']/);
  });

  it("keeps every static reference under a path the server actually mounts", () => {
    // app/main.py mounts only /assets, /basemaps-assets and /fonts from the built dashboard;
    // a root-level public file (e.g. /favicon.svg) would 404 in production.
    const refs = [...html.matchAll(/(?:href|src|content)=["'](\/[^"']*)["']/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^\/(assets|basemaps-assets|fonts|src)\//);
    }
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run tests/indexHtml.test.ts`
Expected: FAIL — description/og/twitter/theme-color/icon assertions all fail (head has only charset, viewport, title).

- [x] **Step 3: Write the head**

Replace the `<head>` block of `frontend/index.html` with (viewport untouched here — that is Task 4):

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <title>CompCat</title>
    <meta name="description" content="Explore reported Seattle SPD incident context around addresses — not a safety score." />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1A222B" />
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
    <link rel="manifest" href="/assets/site.webmanifest" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="CompCat" />
    <meta property="og:title" content="CompCat — reported Seattle incident context" />
    <meta property="og:description" content="Explore reported Seattle SPD incident context around addresses — not a safety score." />
    <meta property="og:image" content="/assets/og-card.png" />
    <meta property="og:image:width" content="1440" />
    <meta property="og:image:height" content="900" />
    <meta property="og:image:alt" content="The CompCat dashboard in night theme, showing reported incident context around Seattle addresses." />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="CompCat — reported Seattle incident context" />
    <meta name="twitter:description" content="Explore reported Seattle SPD incident context around addresses — not a safety score." />
    <meta name="twitter:image" content="/assets/og-card.png" />
  </head>
```

The image URLs are root-relative on purpose: the existing privacy guard test forbids any absolute host in `index.html`, and the deployed origin is not known at build time. Unfurlers resolve relative `og:image` against the page URL — confirm with a real unfurler in Manual verification.

- [x] **Step 4: Run the index tests**

Run: `cd frontend && npx vitest run tests/indexHtml.test.ts`
Expected: PASS — the 3 original privacy-guard tests plus the 6 new ones.

- [x] **Step 5: Commit**

```bash
git add frontend/index.html frontend/tests/indexHtml.test.ts
git commit -m "feat(meta): description, Open Graph, twitter card, theme-color, and favicon links"
```

---

## Task 4: Viewport meta — restore pinch zoom

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/tests/indexHtml.test.ts`

- [x] **Step 1: Add the failing test**

In `frontend/tests/indexHtml.test.ts`, inside the existing `describe("index.html privacy guard", …)` block (next to the `viewport-fit=cover` test), add:

```ts
  it("does not block pinch zoom (WCAG 1.4.4)", () => {
    const viewport = /<meta[^>]*name=["']viewport["'][^>]*>/i.exec(html)?.[0] ?? "";
    expect(viewport).not.toMatch(/maximum-scale/);
    expect(viewport).not.toMatch(/user-scalable/);
    expect(viewport).toMatch(/viewport-fit=cover/);
  });
```

- [x] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/indexHtml.test.ts -t "pinch"`
Expected: FAIL — the viewport still contains `maximum-scale=1.0, user-scalable=no`.

- [x] **Step 3: Drop the scale locks**

In `frontend/index.html`, replace the viewport meta with:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [x] **Step 4: Run the index tests**

Run: `cd frontend && npx vitest run tests/indexHtml.test.ts`
Expected: PASS (all 10).

- [x] **Step 5: Commit**

```bash
git add frontend/index.html frontend/tests/indexHtml.test.ts
git commit -m "fix(a11y): allow pinch zoom by dropping maximum-scale/user-scalable"
```

---

## Task 5: Ephemerality hints at the two moments that matter

**Files:**
- Modify: `frontend/src/components/ContextStrip.tsx`
- Modify: `frontend/src/components/ContextStrip.test.tsx`
- Modify: `frontend/src/components/ManagePlacesModal.tsx`
- Modify: `frontend/src/components/ManagePlacesModal.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [x] **Step 1: Add the failing tests**

In `frontend/src/components/ContextStrip.test.tsx`, add inside the existing describe block:

```tsx
  it("explains that share links recompute once a link is copied", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(true);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    expect(screen.queryByText(/Links recompute from fresh data/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(
      await screen.findByText("Link copied. Links recompute from fresh data — bookmark one to keep a view."),
    ).toBeInTheDocument();
  });

  it("keeps the ephemerality hint off the failure path", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(false);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Couldn't copy — try again.")).toBeInTheDocument();
    expect(screen.queryByText(/Links recompute from fresh data/)).not.toBeInTheDocument();
  });
```

In `frontend/src/components/ManagePlacesModal.test.tsx`, add inside the existing describe block:

```tsx
  it("warns that saved places expire with the session", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    expect(
      screen.getByText("Saved places last for this session (about a day). Keep a result with a share link."),
    ).toBeInTheDocument();
  });
```

- [x] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/ContextStrip.test.tsx src/components/ManagePlacesModal.test.tsx --environment jsdom`
Expected: FAIL — three new tests fail on missing text; every existing test still passes.

- [x] **Step 3: Add the share-toast hint**

In `frontend/src/components/ContextStrip.tsx`, replace the copy-status span (lines 126-128) with a sibling hint that only renders on success — the existing `copy-status` region keeps its exact "Copied" / failure strings so `ContextStrip.test.tsx:95-118` stay green:

```tsx
          <span className="mc-copy-status" data-testid="copy-status" role="status" aria-live="polite">
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy — try again." : ""}
          </span>
          {copyState === "copied" ? (
            <p className="mc-copy-hint">Link copied. Links recompute from fresh data — bookmark one to keep a view.</p>
          ) : null}
```

- [x] **Step 4: Add the manage-places note**

In `frontend/src/components/ManagePlacesModal.tsx`, replace the note slot (line 237) with:

```tsx
            <p className="mc-places-expiry">Saved places last for this session (about a day). Keep a result with a share link.</p>
            <div className="mc-places-note"><Notice /></div>
```

- [x] **Step 5: Style both hints**

In `frontend/src/styles/mapWorkspace.css`, immediately after the `.mc-copy-status{…}` rule (currently line 644), append:

```css
.mc-copy-hint{margin:2px 0 0;font-size:12px;line-height:1.45;color:var(--text-dim);}
.mc-places-expiry{margin:10px 0 0;font-size:12px;line-height:1.45;color:var(--text-dim);}
```

- [x] **Step 6: Run both suites**

Run: `cd frontend && npx vitest run src/components/ContextStrip.test.tsx src/components/ManagePlacesModal.test.tsx --environment jsdom`
Expected: PASS (3 new + all existing).

- [x] **Step 7: Commit**

```bash
git add frontend/src/components/ContextStrip.tsx frontend/src/components/ContextStrip.test.tsx frontend/src/components/ManagePlacesModal.tsx frontend/src/components/ManagePlacesModal.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(copy): say that sessions expire and share links recompute"
```

---

## Task 6: Error-copy hygiene — no raw response body can reach a component

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`
- Modify: `frontend/src/components/PersonalUpload.tsx`
- Modify: `frontend/src/components/PersonalUpload.test.tsx`

- [x] **Step 1: Replace the two raw-body client tests with mapping tests**

In `frontend/src/api/client.test.ts`:

1. Extend the import on line 3 to pull in the new constants and the upload helper:

```ts
import { createPlace, deletePlace, getDashboardFreshness, getDashboardSummary, getTrends, streamAssistantChat, streamAssistantCommand, uploadPersonalData, GENERIC_ERROR_MESSAGE, RATE_LIMITED_MESSAGE, SERVER_ERROR_MESSAGE, SESSION_EXPIRED_MESSAGE } from "./client";
```

2. **Delete** the two existing tests at lines 63-73 ("throws response text when a request fails" and "throws a status fallback when a failed request has no response text") and put this block in their place:

```ts
  it("maps 401 to the session-expired line and never leaks the body", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Missing or invalid session cookie" }), { status: 401 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    // The body is still available for debugging, just never in the thrown message.
    expect(debug).toHaveBeenCalled();
  });

  it("maps 429 to the retry line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Request limit reached — please retry shortly." }), { status: 429 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("maps 5xx to the our-side line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(SERVER_ERROR_MESSAGE);
  });

  it("maps a network failure to the our-side line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getDashboardSummary()).rejects.toThrow(SERVER_ERROR_MESSAGE);
  });

  it("maps any other failing status to the generic retry line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "csv_text must not be empty" }), { status: 422 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(GENERIC_ERROR_MESSAGE);
  });

  it("never surfaces a JSON detail body from any failing status", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ detail: "leaky-internal-detail" }), { status }),
      );
      await expect(getDashboardSummary()).rejects.toThrow(
        expect.not.stringContaining("leaky-internal-detail") as unknown as string,
      );
    }
  });

  it("re-throws abort errors untouched so cancelled requests stay control flow", async () => {
    const abort = new DOMException("The user aborted a request.", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    await expect(getDashboardSummary()).rejects.toBe(abort);
  });

  it("maps upload failures too (uploadPersonalData bypasses request())", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Unsupported location-history format" }), { status: 422 }),
    );

    await expect(uploadPersonalData(new File(["{}"], "t.json"))).rejects.toThrow(GENERIC_ERROR_MESSAGE);
  });
```

(The `expect.not.stringContaining` cast is needed because `rejects.toThrow`'s signature expects a string/RegExp/Error; the asymmetric matcher works at runtime.)

- [x] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — the new constants do not exist (import error) / thrown messages are raw bodies.

- [x] **Step 3: Implement the mapping in `client.ts`**

In `frontend/src/api/client.ts`, insert these exports directly above `async function request<T>` (line 57):

```ts
/**
 * Status→copy mapping for every failing HTTP call. A raw response body (FastAPI's
 * `{"detail": …}`, a reverse proxy's HTML error page, a stack trace) must never become a
 * thrown Error.message: components render those messages, so the body would reach the
 * screen. Bodies go to console.debug instead, which keeps them debuggable in devtools.
 */
export const SESSION_EXPIRED_MESSAGE = "Session expired — reload to start a new one.";
/** Matches the wording the rate limiter itself uses (app/ratelimit.py). */
export const RATE_LIMITED_MESSAGE = "Request limit reached — please retry shortly.";
export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Try again shortly.";
export const GENERIC_ERROR_MESSAGE = "That request didn't go through. Try again.";

export function friendlyRequestError(status: number): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  if (status >= 500) return SERVER_ERROR_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
}

function isAbort(cause: unknown): boolean {
  return (cause as { name?: string } | null)?.name === "AbortError";
}
```

Then replace the body of `request<T>` (lines 57-77) with:

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> | undefined),
      },
    });
  } catch (cause) {
    // A cancelled request is control flow, not a failure: callers check signal.aborted.
    if (isAbort(cause)) throw cause;
    console.debug("request network failure", path, cause);
    throw new Error(SERVER_ERROR_MESSAGE);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.debug("request failed", path, response.status, body);
    throw new Error(friendlyRequestError(response.status));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
```

And replace `uploadPersonalData` (lines 118-126) — it bypasses `request()` because it posts `FormData`, so it needs the same treatment:

```ts
export async function uploadPersonalData(file: File): Promise<{ place_cluster_count: number }> {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch("/uploads", { method: "POST", credentials: "include", body });
  } catch (cause) {
    if (isAbort(cause)) throw cause;
    console.debug("upload network failure", cause);
    throw new Error(SERVER_ERROR_MESSAGE);
  }
  if (!response.ok) {
    console.debug("upload failed", response.status, await response.text().catch(() => ""));
    throw new Error(friendlyRequestError(response.status));
  }
  return response.json();
}
```

- [x] **Step 4: Run the client tests**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: PASS (8 new + the untouched originals).

- [x] **Step 5: Add the failing `PersonalUpload` test**

In `frontend/src/components/PersonalUpload.test.tsx`, add a module mock above the component import and a new test. Replace the file's import block and describe body with:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  uploadPersonalData: vi.fn(),
  deletePersonalData: vi.fn(),
}));

import { PersonalUpload } from "./PersonalUpload";
import { deletePersonalData, uploadPersonalData } from "../api/client";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

describe("PersonalUpload", () => {
  it("shows the caveat and enables upload only after consent + a file", () => {
    render(<PersonalUpload onUploaded={vi.fn()} />);
    expect(screen.getByText(/never claims you were present/i)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /^upload$/i });
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I understand/i));
    expect(button).toBeDisabled(); // a file is still required

    const file = new File(["{}"], "timeline.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/location history file/i), {
      target: { files: [file] },
    });
    expect(button).not.toBeDisabled();
  });

  it("shows a static fallback instead of the thrown error message", async () => {
    vi.mocked(uploadPersonalData).mockRejectedValue(new Error("500: {\"detail\":\"traceback…\"}"));
    render(<PersonalUpload onUploaded={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/I understand/i));
    fireEvent.change(screen.getByLabelText(/location history file/i), {
      target: { files: [new File(["{}"], "timeline.json", { type: "application/json" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Upload failed. Check the file and try again.");
    expect(status).not.toHaveTextContent(/traceback/);
  });

  it("shows a static fallback when the delete call fails", async () => {
    vi.mocked(deletePersonalData).mockRejectedValue(new Error("boom: raw body"));
    render(<PersonalUpload onUploaded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /delete my uploaded data/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't delete your uploaded data. Try again."),
    );
  });
});
```

- [x] **Step 6: Run to verify the two new tests fail**

Run: `cd frontend && npx vitest run src/components/PersonalUpload.test.tsx --environment jsdom`
Expected: FAIL — the status shows the thrown message, not the static fallback.

- [x] **Step 7: Use static fallbacks in `PersonalUpload.tsx`**

In `frontend/src/components/PersonalUpload.tsx`, replace the two catch blocks (lines 22-24 and 34-36):

```tsx
    } catch (error) {
      console.debug("personal upload failed", error);
      setStatus("Upload failed. Check the file and try again.");
    } finally {
```

```tsx
    } catch (error) {
      console.debug("personal upload delete failed", error);
      setStatus("Couldn't delete your uploaded data. Try again.");
    } finally {
```

- [x] **Step 8: Run the suite**

Run: `cd frontend && npx vitest run src/api/client.test.ts src/components/PersonalUpload.test.tsx --environment jsdom`
Expected: PASS.

- [x] **Step 9: Full frontend sweep (the client change touches every caller)**

Run: `cd frontend && npm test && npm run lint`
Expected: PASS. If a test asserted a raw-body error string anywhere else, update it to the mapped constant — do **not** reintroduce body pass-through.

- [x] **Step 10: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts frontend/src/components/PersonalUpload.tsx frontend/src/components/PersonalUpload.test.tsx
git commit -m "fix(errors): map request failures to friendly copy; never surface raw bodies"
```

---

## Task 7: One export label — "Export CSV"

`AnalysisCard.tsx:80` already reads "Export CSV"; only the manage dialog's footer link differs, and it keeps "Tableau-ready" as a descriptor line rather than a button label.

**Files:**
- Modify: `frontend/src/components/ManagePlacesModal.tsx`
- Modify: `frontend/src/components/ManagePlacesModal.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [x] **Step 1: Add the failing test**

In `frontend/src/components/ManagePlacesModal.test.tsx`, add inside the existing describe block:

```tsx
  it("labels the export link 'Export CSV' and keeps Tableau as a descriptor", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link).toHaveAttribute("href", "/exports/current.csv");
    expect(screen.queryByRole("link", { name: /Download Tableau CSV/ })).not.toBeInTheDocument();
    expect(screen.getByText("Tableau-ready place summary for the current session.")).toBeInTheDocument();
  });
```

- [x] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/ManagePlacesModal.test.tsx --environment jsdom -t "Export CSV"`
Expected: FAIL — the link is named "Download Tableau CSV".

- [x] **Step 3: Relabel**

In `frontend/src/components/ManagePlacesModal.tsx`, replace the footer (lines 246-248) with:

```tsx
        <div className="mc-modal-foot">
          <a className="mc-link-copy" href={exportHref}>Export CSV</a>
          <p className="mc-export-note">Tableau-ready place summary for the current session.</p>
        </div>
```

- [x] **Step 4: Style the descriptor**

In `frontend/src/styles/mapWorkspace.css`, immediately after the `.mc-modal-foot{…}` rule (line 247), append:

```css
.mc-export-note{margin:6px 0 0;font-size:12px;line-height:1.45;color:var(--text-dim);}
```

- [x] **Step 5: Run and grep for stragglers**

Run: `cd frontend && npx vitest run src/components/ManagePlacesModal.test.tsx src/components/AnalysisCard.test.tsx --environment jsdom`
Expected: PASS.

Run: `cd frontend && grep -rn "Download Tableau\|Tableau CSV" src/` — expected: no matches.

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/ManagePlacesModal.tsx frontend/src/components/ManagePlacesModal.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "fix(copy): one export label — Export CSV, Tableau as descriptor"
```

---

## Task 8: Glosses — spell out SPD, define NIBRS

**Files:**
- Modify: `frontend/src/components/DataFreshness.tsx`
- Modify: `frontend/src/components/DataFreshness.test.tsx`
- Modify: `frontend/src/lib/methodsDefinitions.ts`
- Modify: `frontend/src/components/MethodsAppendix.test.tsx`
- Modify: `frontend/src/components/IncidentDetailsSection.tsx`
- Create: `frontend/src/components/IncidentDetailsSection.test.tsx`
- Modify: `frontend/src/styles/mapWorkspace.css`

- [x] **Step 1: Add the failing tests**

In `frontend/src/components/DataFreshness.test.tsx`, add inside the existing describe block:

```tsx
  it("spells out SPD on first use in the freshness tooltip", () => {
    const { container } = render(<DataFreshness freshness={loaded} layer="reported" />);
    expect(container.querySelector(".mc-freshness")).toHaveAttribute(
      "title",
      expect.stringContaining("reported Seattle Police Department (SPD) incidents"),
    );
    // The visible pill stays short.
    expect(screen.getByText("Data through Jun 22, 2026")).toBeInTheDocument();
  });
```

In `frontend/src/components/MethodsAppendix.test.tsx`, add inside the existing describe block:

```tsx
  it("defines NIBRS in the appendix", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    expect(screen.getByText("NIBRS group")).toBeInTheDocument();
    expect(screen.getByText(/National Incident-Based Reporting System/)).toBeInTheDocument();
  });
```

(`fireEvent` is already imported in that file. Its first test iterates `METHODS_DEFINITIONS` and asserts every `term` renders, so the new entry is covered there too — this test pins the plain-language body as well.)

Create `frontend/src/components/IncidentDetailsSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IncidentDetailsSection } from "./IncidentDetailsSection";
import { incidentNoun } from "../lib/layerCopy";
import type { IncidentDetail, IncidentDetailsResponse } from "../types";

afterEach(cleanup);

function incident(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    place_id: "p1", place_label: "Home", incident_id: "i1", external_incident_id: null,
    report_number: "R-1", occurred_at: "2026-03-02T14:30:00", reported_at: null,
    offense_category: "PROPERTY", offense_subcategory: null, nibrs_group: "A",
    block_address: "1 MAIN ST", distance_m: 40, ...overrides,
  };
}

function details(...incidents: IncidentDetail[]): IncidentDetailsResponse {
  return { incidents, returned_count: incidents.length, total_count: incidents.length, limit: 200, radius_m: 250 };
}

const noun = incidentNoun("reported");

describe("IncidentDetailsSection NIBRS gloss", () => {
  it("wraps the NIBRS acronym in an abbr with a plain-language title (table layout)", () => {
    const { container } = render(
      <IncidentDetailsSection details={details(incident())} noun={noun} layout="table" showCategory subcategoryHeader="Subcategory" />,
    );
    const abbr = container.querySelector("abbr");
    expect(abbr).toHaveTextContent("NIBRS");
    expect(abbr).toHaveAttribute("title", expect.stringContaining("National Incident-Based Reporting System"));
    // The group letter stays outside the abbr, in the same cell.
    expect(abbr!.parentElement).toHaveTextContent("NIBRS A");
  });

  it("glosses NIBRS in the card layout too", () => {
    const { container } = render(
      <IncidentDetailsSection details={details(incident())} noun={noun} layout="cards" showCategory subcategoryHeader="Subcategory" />,
    );
    expect(container.querySelector("abbr")).toHaveAttribute(
      "title",
      expect.stringContaining("National Incident-Based Reporting System"),
    );
  });

  it("leaves rows without a NIBRS group unglossed", () => {
    const { container } = render(
      <IncidentDetailsSection details={details(incident({ nibrs_group: null }))} noun={noun} layout="table" showCategory subcategoryHeader="Subcategory" />,
    );
    expect(container.querySelector("abbr")).toBeNull();
    expect(screen.getByText("All reported")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/DataFreshness.test.tsx src/components/MethodsAppendix.test.tsx src/components/IncidentDetailsSection.test.tsx --environment jsdom`
Expected: FAIL on all three new assertions.

- [x] **Step 3: Spell out SPD in the freshness tooltip**

In `frontend/src/components/DataFreshness.tsx`, after the existing `noun` (line 35-36), add the long form and use it in the tooltip detail only:

```tsx
  const noun =
    layer === "calls" ? "911 calls" : layer === "arrests" ? "SPD arrests" : "reported SPD incidents";
  // The tooltip is the acronym's first use in the persistent chrome, so spell it out there;
  // the visible pill and the empty-state line stay short.
  const longNoun =
    layer === "calls"
      ? "911 calls"
      : layer === "arrests"
        ? "Seattle Police Department (SPD) arrests"
        : "reported Seattle Police Department (SPD) incidents";
```

and change the first entry of the `detail` array (line 47) from `` `${entry.incident_count.toLocaleString()} ${noun}` `` to:

```tsx
    `${entry.incident_count.toLocaleString()} ${longNoun}`,
```

- [x] **Step 4: Add the NIBRS methods entry**

In `frontend/src/lib/methodsDefinitions.ts`, append as the last element of `METHODS_DEFINITIONS` (after `exactPValue`):

```ts
  { id: "nibrsGroup", term: "NIBRS group", shownAs: "NIBRS A",
    plain: "The FBI's National Incident-Based Reporting System classification SPD files each offense under. Group A covers the offenses reported in full detail; Group B covers a shorter list reported only when an arrest is made.",
    howToRead: "A filing category, not a severity ranking." },
```

- [x] **Step 5: Gloss NIBRS inline**

In `frontend/src/components/IncidentDetailsSection.tsx`:

1. Extend the React import at the top of the file (the file currently imports only types):

```tsx
import type { ReactNode } from "react";
```

2. Replace `incidentSubtypeLabel` (lines 9-12) with:

```tsx
const NIBRS_GLOSS =
  "National Incident-Based Reporting System — the FBI offense classification SPD files each report under.";

function incidentSubtypeLabel(incident: IncidentDetail): ReactNode {
  if (incident.offense_subcategory) return titleCase(incident.offense_subcategory);
  if (!incident.nibrs_group) return "All reported";
  return (
    <>
      <abbr title={NIBRS_GLOSS}>NIBRS</abbr> {incident.nibrs_group}
    </>
  );
}
```

(Both call sites — the `<td>` at line 80 and the `<span>` at line 123 — already render the result as a child, so no other change is needed.)

- [x] **Step 6: Style `abbr`**

In `frontend/src/styles/mapWorkspace.css`, append after the `.mc-sr{…}` rule (line 31):

```css
.mc-scope abbr[title]{text-decoration:underline dotted;text-underline-offset:2px;cursor:help;}
```

- [x] **Step 7: Run the suites**

Run: `cd frontend && npx vitest run src/components/DataFreshness.test.tsx src/components/MethodsAppendix.test.tsx src/components/IncidentDetailsSection.test.tsx src/components/AnalysisCard.test.tsx --environment jsdom`
Expected: PASS.

- [x] **Step 8: Lint**

Run: `cd frontend && npm run lint`
Expected: clean (the `ReactNode` return type change is the one thing `tsc` could flag).

- [x] **Step 9: Commit**

```bash
git add frontend/src/components/DataFreshness.tsx frontend/src/components/DataFreshness.test.tsx frontend/src/lib/methodsDefinitions.ts frontend/src/components/MethodsAppendix.test.tsx frontend/src/components/IncidentDetailsSection.tsx frontend/src/components/IncidentDetailsSection.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "docs(copy): gloss SPD on first use and define NIBRS inline + in the appendix"
```

---

## Task 9: Extend the invariant sweep to the About copy

The About panel is the one surface that **states** the invariant, so it necessarily contains banned vocabulary — but only inside the three exported constants. This task pins that: remove exactly those constants from the rendered text, then run the standard banned list (`CompareVerdict.test.tsx:41-50` pattern) over everything that is left. Run this **after** Task 8, so the sweep also covers any copy the gloss task touched.

**Files:**
- Modify: `frontend/src/components/AboutModal.test.tsx`

- [ ] **Step 1: Add the failing sweep**

Append to `frontend/src/components/AboutModal.test.tsx` — extend the import line to pull the constants in:

```tsx
import { AboutModal, ABOUT_DATA_CAVEAT, ABOUT_INVARIANT, ABOUT_RELIANCE_LIMIT } from "./AboutModal";
```

and add this describe block at the end of the file:

```tsx
// The standing invariant sweep (mirrors CompareVerdict / PlaceContextCard / CompareRankedList).
// About is the one surface that STATES the invariant, so the fixed caveat constants are
// removed first — exactly as the other sweeps stay clean by scoping around REVISED_CAVEAT.
const BANNED = ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"];
const FIXED_CAVEATS = [ABOUT_INVARIANT, ABOUT_RELIANCE_LIMIT, ABOUT_DATA_CAVEAT];

describe("AboutModal invariant sweep", () => {
  it("confines safety/risk vocabulary to the three fixed caveat constants", () => {
    const { container } = render(<AboutModal onClose={vi.fn()} />);
    const rendered = (container.textContent ?? "").toLowerCase();

    let remaining = rendered;
    for (const caveat of FIXED_CAVEATS) {
      const lowered = caveat.toLowerCase();
      expect(remaining).toContain(lowered); // the caveat must actually be on screen
      remaining = remaining.split(lowered).join(" ");
    }

    for (const banned of BANNED) {
      expect(remaining).not.toContain(banned);
    }
  });

  it("keeps the fixed caveats stating — never scoring — the invariant", () => {
    expect(ABOUT_INVARIANT).toMatch(/does not score safety/);
    expect(ABOUT_INVARIANT).toMatch(/rank places as safe, unsafe, or dangerous/);
    expect(ABOUT_INVARIANT).toMatch(/claim that anyone was present at an incident/);
    expect(ABOUT_RELIANCE_LIMIT).toMatch(/Don't rely on CompCat for safety or legal decisions/);
    // The only "risk" occurrence in the panel is the shipped per-card caveat.
    expect(ABOUT_DATA_CAVEAT).toMatch(/not a personal risk prediction/);
    expect(FIXED_CAVEATS.filter((text) => /risk/i.test(text))).toEqual([ABOUT_DATA_CAVEAT]);
  });
});
```

- [ ] **Step 2: Run the sweep**

Run: `cd frontend && npx vitest run src/components/AboutModal.test.tsx --environment jsdom`
Expected: PASS (10 tests). If the sweep fails on a leftover banned word, **fix the About copy**, not the sweep — the only sanctioned occurrences are the three constants.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AboutModal.test.tsx
git commit -m "test(invariant): sweep the About copy, allowing only the fixed caveat constants"
```

---

## Task 10: Full gate and slice completion

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate from the worktree root**

Run: `make test-all`
Expected: pytest green (backend untouched — no `app/` file changed in this slice), `ruff check .` clean, `npm test` green (every suite, including the new `AboutModal`, `IncidentDetailsSection`, and extended `indexHtml` files), `npm run build` succeeds and writes `app/static/dashboard/` with the five new files under `assets/`.

If pytest or ruff report anything, stop: this slice must not have touched Python. Confirm with `git diff --stat origin/main -- app/ tests/ alembic/` → empty.

- [ ] **Step 2: Confirm the slice completion criteria**

Check each against what the gate and the code now show:

- [ ] **1a.** ⓘ opens About on desktop — `MapWorkspace.test.tsx` "opens the About panel from the topbar and closes it on Escape".
- [ ] **1b.** ⓘ opens About on mobile — `MapWorkspace.test.tsx` "narrow viewport: the About button stays in the topbar beside the theme toggle".
- [ ] **1c.** Every section present — `AboutModal.test.tsx` "renders a labelled modal dialog with every section" (What this is / Scope / Data sources / What's stored / Honest limits / License).
- [ ] **1d.** Keyboard accessible — `AboutModal.test.tsx` focus-in/restore, Escape/close/scrim, and Tab-trap tests.
- [ ] **2a.** Link unfurls with title, description, image — `indexHtml.test.ts` "carries an Open Graph card…" and "carries a large-image twitter card" (+ manual unfurler check below).
- [ ] **2b.** Tab shows a favicon — `indexHtml.test.ts` "links the favicon set and the web manifest"; `ls app/static/dashboard/assets/favicon.svg` after `npm run build`.
- [ ] **3a.** No code path renders a raw response body — `client.test.ts` "never surfaces a JSON detail body from any failing status" + the four mapping tests + `PersonalUpload.test.tsx` static-fallback tests.
- [ ] **3b.** Export label is "Export CSV" on every surface — `ManagePlacesModal.test.tsx` "labels the export link 'Export CSV'…"; `grep -rn "Download Tableau\|Tableau CSV" frontend/src/` returns nothing; `AnalysisCard.tsx:80` was already "Export CSV".
- [ ] **3c.** Pinch-zoom works — `indexHtml.test.ts` "does not block pinch zoom (WCAG 1.4.4)" (+ manual device check below).
- [ ] **4.** `make test-all` green, including the extended invariant sweep (`AboutModal.test.tsx` "confines safety/risk vocabulary to the three fixed caveat constants").

- [ ] **Step 3: Report status to the orchestrator**

Summarize: gate result, the ten commits, and any Manual verification item that still needs a human.

---

## Manual verification (orchestrator / human — not automatable here)

These three items are part of the slice's completion criteria but cannot be asserted in CI. Run them after the branch is deployed or served locally, and report pass/fail.

1. **Pinch-zoom on a real phone.** Open the app on an actual iOS Safari and Android Chrome device (not a desktop emulator — emulators ignore `user-scalable`). Pinch on the rail/panel text: the page must zoom. Pinching over the map should still do MapLibre's own map zoom rather than page zoom. If page zoom now fights the map inside the canvas, report it — the fix belongs in MapLibre gesture options, not by restoring the viewport lock.
2. **OG unfurl.** Paste the deployed URL into a link unfurler (Slack DM to yourself, or `https://cards-dev.twitter.com/validator` / any OG debugger) and confirm the card shows the title, the description "Explore reported Seattle SPD incident context around addresses — not a safety score.", and the night-theme dashboard image. `og:image` is root-relative by design (the privacy guard test forbids absolute hosts in `index.html`) — if a specific unfurler refuses to resolve it, report which one; the fix is a deploy-time absolute-URL injection, a separate decision.
3. **Tab-order pass.** With the keyboard only, from a fresh page load: Tab through topbar (brand → ⓘ → theme toggle) → search pill → map controls → rail/drawer → context strip → assistant input. Then open About with Enter on ⓘ, Tab through the whole dialog (focus must never escape to the page behind), Escape out, and confirm focus lands back on ⓘ. Repeat for the Manage places dialog. The review flagged the **custom drag surfaces** (drawer resize handle, bottom-sheet snap handle) as the risk area — check whether they are reachable/announced, and report findings; fixing them is out of scope for this slice.

---

## Out of scope (do not do here)

- Any backend/`app/` change, including adding a static mount for root-level public files. The `/assets` placement exists precisely to avoid one.
- A standalone legal ToS document or a cookie banner (no third-party cookies or tracking exist).
- Guided tours or multi-step onboarding beyond the existing empty state.
- Renaming or reworking the Tabby persona.
- Reworking `streamAssistantSse`'s error path — verified safe: `useAssistantTurn.ts:104-109` catches with the static `OFFLINE_MESSAGE` / `COMMAND_FAILURE_MESSAGE` constants and never surfaces a thrown message.
- Fixing drag-surface keyboard accessibility (Manual verification item 3 records findings only).
- Regenerating the OG card as a purpose-built 1200×630 graphic; the spec's decision is the README night screenshot, replaceable later.
