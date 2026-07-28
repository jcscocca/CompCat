# Public instance, slice 2 — trust surface & link polish — design

**Date:** 2026-07-27 · **Status:** approved design, pre-plan.
**Scope:** frontend-only. Everything a stranger clicking a shared link needs to trust the
app: an in-app About/Privacy panel, real link metadata, honest ephemerality hints, and the
professionalism nits from the 2026-07-27 review. Parent:
`2026-07-27-public-instance-design.md`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| About entry point | **ⓘ button in the topbar beside the theme toggle**, both breakpoints, opening a modal | The topbar is the one persistent chrome surface on desktop and mobile; reuses `ManagePlacesModal`'s focus-trap/Escape pattern |
| Operator identity | **"Built by Jacob Scocca"** + GitHub repo link; no email in-app | User decision 2026-07-27; the repo's issue tracker and profile are the contact path |
| Ephemerality messaging | A storage section in About **plus** a one-line hint at the two moments it matters: the share-link copy toast and the manage-places dialog | The 24 h session expiry is the biggest surprise a returning user can hit; say it where places are saved and where links are copied, not only in a panel nobody opens |
| Favicon | The existing `mc-brand` cat mark exported as SVG favicon + PNG fallbacks + apple-touch-icon; `theme-color` for light and night | Reuse the shipped brand, no new art direction |
| OG image | Static card in `frontend/public/` derived from the README night screenshot | Cheap, honest, replaceable later |
| Error copy | `api/client.ts` `request()` never surfaces raw response bodies: status-mapped friendly strings, body to `console.debug`; `PersonalUpload` uses a static fallback | Closes the one break from the app's static-fallback discipline (raw `{"detail":…}` could render) |
| Export label | **"Export CSV"** everywhere; the manage-places dialog keeps "Tableau-ready" as a descriptor line, not the button label | One action, one name; "Tableau" assumes tool familiarity most visitors lack |
| Pinch zoom | Drop `maximum-scale=1.0, user-scalable=no` from the viewport meta | WCAG 1.4.4; MapLibre handles its own gesture conflicts — the app-wide block is unnecessary |
| Jargon glosses | "Seattle Police Department (SPD)" spelled out at first use (freshness tooltip, About); NIBRS gets a Methods-appendix entry + inline `<abbr>` gloss in the incident table | The Methods appendix already defines nearly everything else; these two leaked raw |

## Components

### 1. About/Privacy panel (`AboutModal.tsx`)

Sections, all short, all in the app's existing sober register:

- **What this is** — two sentences + the invariant verbatim: reported Seattle SPD incident
  context around places; does not score safety, rank places safe/unsafe, or claim anyone
  was present. "Built by Jacob Scocca · Source on GitHub" (link).
- **Scope** — Seattle only, and why the map is locked there; data layers named
  (reported incidents / arrests / 911 calls) with the one-line framing each already has.
- **Data sources** — Seattle Police Department (SPD) datasets via the City of Seattle open
  data portal, public-domain terms; basemap © OpenStreetMap contributors / Protomaps;
  "Data through" pill explained.
- **What's stored** — anonymous 24 h session cookie; saved places tied to that session and
  expiring with it; share links carry only ~110 m-generalized coordinates; zero third-party
  requests (tiles, fonts, geocoding all first-party); personal uploads disabled on this
  instance.
- **Honest limits** — reported data can be incomplete, delayed, corrected, or generalized;
  no accounts, no production authentication, no encryption at rest; don't rely on CompCat
  for safety or legal decisions.
- **License** — MIT; link to LICENSE.

### 2. Link metadata (`index.html`, `frontend/public/`)

`<title>` kept; add meta description, OG title/description/image/type, twitter card,
`theme-color` (both schemes), favicon set (SVG + 32/180 PNG), web manifest name/icons.
Description copy states the invariant-safe one-liner ("explore reported Seattle SPD incident
context around addresses — not a safety score").

### 3. Ephemerality hints

- Share-toast line: "Link copied. Links recompute from fresh data — bookmark one to keep a
  view."
- Manage-places dialog note: "Saved places last for this session (about a day). Keep a
  result with a share link."

### 4. Hygiene fixes

Error-copy mapping in `client.ts` (+ `PersonalUpload` fallback), export-label unification,
viewport meta change, SPD/NIBRS glosses, `abbr` styling. Each is small and listed in the
plan as its own task.

## Error handling

Status→copy mapping: 401 → "Session expired — reload to start a new one."; 429 → existing
retry copy; 5xx/network → "Something went wrong on our side. Try again shortly."; everything
else → generic retry line. Raw bodies never rendered; logged to console for debugging.

## Testing

- `AboutModal`: renders all sections, focus trap, Escape, aria labeling — same test shape as
  `ManagePlacesModal`.
- Client error mapping: unit tests that a JSON `{"detail":…}` body never reaches thrown
  `Error.message` surfaced to components.
- Snapshot/string assertions for the two ephemerality hints and the unified export label.
- Invariant sweep test extended to the About copy (no safe/unsafe/danger/risk-scoring
  language; the fixed caveat phrasing is the only "risk" occurrence).
- Manual: pinch-zoom on a real phone; tab-order pass over topbar → rail → modal (the review
  flagged custom drag surfaces as the risk area); OG card check via a link unfurler.

## Invariant checkpoint

The About panel and meta description are new public copy that *states* the invariant — the
sweep test pins that they never violate it. No engine, guard, or analysis changes.

## Non-goals

- A standalone legal ToS document, cookie banners (no third-party cookies or tracking exist).
- Guided tours / multi-step onboarding beyond the existing empty state.
- Renaming or reworking the Tabby persona (kept as-is by decision — the About panel's sober
  register is the counterweight).
- Backend changes of any kind.

## Slice completion criteria

1. ⓘ opens About on desktop and mobile; every section present; keyboard accessible.
2. A shared link unfurls with title, description, and image; the tab shows a favicon.
3. No code path can render a raw response body; export label is "Export CSV" on every
   surface; pinch-zoom works on mobile.
4. `make test-all` green, including the extended invariant sweep.
