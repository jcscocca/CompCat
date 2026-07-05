# Shell Overhaul (Slice 3 of Map & UI Overhaul) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recolor the whole shell to Civic Clear (light surfaces, blue accent) with a night mode, self-host the fonts (zero external requests), and restructure the layout to the Evolved Workspace (search pill, in-panel Analyst dock, bottom-right legend/zoom cluster).

**Architecture:** Stage 1 (Tasks 1–7) makes the app themable with the layout untouched: self-hosted fonts + guard test, semantic-token rewrite of `mapWorkspace.css` (a dark-panel → light-panel inversion driven by a substitution table), a `[data-theme="dark"]` override block, `useTheme` + `ThemeToggle`, and the map-style swap with `style.load` layer re-registration (extracting the layer builders into `lib/mapLayers.ts`). Stage 2 (Tasks 8–10) restructures: SearchPill replaces the Add Pin button, AssistantPanel docks into the workspace panel, legend/zoom move bottom-right. Task 11 is the full gate + live verification + docs.

**Tech Stack:** CSS custom properties (no CSS-in-JS), React hooks, maplibre-gl `setStyle`/`style.load`, committed woff2 fonts (OFL).

**Spec:** `docs/superpowers/specs/2026-07-05-shell-overhaul-design.md`. Zero backend changes; zero migrations. Every commit leaves `make test-all` green.

## File structure

| File | Role |
|---|---|
| `frontend/public/fonts/*.woff2` + `frontend/src/styles/fonts.css` (new) | Self-hosted Archivo + IBM Plex Mono, `@font-face` |
| `frontend/tests/indexHtml.test.ts` (new) | No-external-hosts guard on index.html |
| `frontend/src/styles/mapWorkspace.css` (rewrite in place) | Semantic tokens, light values + `[data-theme="dark"]` overrides |
| `frontend/src/styles.css` (fold) | Legacy `:root` replaced by shared tokens |
| `frontend/src/lib/useTheme.ts` + `frontend/src/components/ThemeToggle.tsx` (new) | Theme state + toggle |
| `frontend/src/lib/mapLayers.ts` (new, extracted) | `registerDataLayers(map)` + layer builders + constants + `incidentCardElement` |
| `frontend/src/components/MapCanvas.tsx` (modify) | `theme` prop, `setStyle` swap, `style.load` re-registration, `styleEpoch` |
| `frontend/src/components/SearchPill.tsx` (new) | Top-left search + pin-arm pill |
| `frontend/src/components/AssistantPanel.tsx` (modify) | Dock variant: collapse, empty-state explainer, quick-action chips |
| `frontend/src/components/BottomSheet.tsx` (modify) | Flex column with a `dock` slot |
| `frontend/src/components/MapWorkspace.tsx` (modify) | Wire theme, pill, dock; drop `.mc-controls`; legend placement |

---

## STAGE 1 — THEME FOUNDATION

### Task 1: Self-hosted fonts + no-external-hosts guard

**Files:**
- Create: `frontend/public/fonts/` (6 woff2 files + `OFL.txt` note), `frontend/src/styles/fonts.css`
- Modify: `frontend/index.html` (remove 3 Google-Fonts link tags, lines 6-11), `frontend/src/main.tsx` (import fonts.css first)
- Test: `frontend/tests/indexHtml.test.ts`

- [ ] **Step 1: Write the failing guard test**

```ts
// frontend/tests/indexHtml.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");

describe("index.html privacy guard", () => {
  it("references no external hosts (fonts must be self-hosted)", () => {
    const externals = html.match(/https?:\/\/[^"' >]+/g) ?? [];
    expect(externals).toEqual([]);
  });

  it("loads the self-hosted font stylesheet indirectly via the bundle", () => {
    // fonts.css is imported from main.tsx; index.html itself needs no font link at all.
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run tests/indexHtml.test.ts`
Expected: FAIL — the Google Fonts URLs match.

- [ ] **Step 3: Download the woff2 files (network step)**

The css2 API serves woff2 URLs to modern-UA requests, split by unicode-range; take the **latin** subset per weight:

```bash
cd "$(git rev-parse --show-toplevel)/frontend"
mkdir -p public/fonts
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap" -o /tmp/archivo.css
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" -o /tmp/plexmono.css
```

In each downloaded css, every `@font-face` block has a `/* latin */` comment before it and a `unicode-range: U+0000-00FF,...` — extract the `src: url(...woff2)` from the **latin** block of each weight (4 for Archivo, 2 for Plex Mono) and download:

```bash
# repeat per extracted URL; name files by family-weight:
curl -s -o public/fonts/archivo-400.woff2 "<latin url for Archivo 400>"
curl -s -o public/fonts/archivo-500.woff2 "<latin url for Archivo 500>"
curl -s -o public/fonts/archivo-600.woff2 "<latin url for Archivo 600>"
curl -s -o public/fonts/archivo-700.woff2 "<latin url for Archivo 700>"
curl -s -o public/fonts/plexmono-400.woff2 "<latin url for IBM Plex Mono 400>"
curl -s -o public/fonts/plexmono-500.woff2 "<latin url for IBM Plex Mono 500>"
ls -la public/fonts   # expect 6 files, each ~15-50KB; total well under 250KB
```

Add `public/fonts/OFL.txt` containing a short provenance note: both families are SIL Open Font License 1.1 (copy the OFL 1.1 text from either family's upstream repo, e.g. github.com/Omnibus-Type/Archivo or github.com/IBM/plex — one license file covering both, with a header line naming the two families and sources). These files are **committed to git** (small + licensed), unlike the gitignored tile artifacts.

- [ ] **Step 4: Write fonts.css and wire it**

```css
/* frontend/src/styles/fonts.css — self-hosted, latin subsets (OFL; see public/fonts/OFL.txt) */
@font-face{font-family:'Archivo';font-style:normal;font-weight:400;font-display:swap;src:url('/fonts/archivo-400.woff2') format('woff2');}
@font-face{font-family:'Archivo';font-style:normal;font-weight:500;font-display:swap;src:url('/fonts/archivo-500.woff2') format('woff2');}
@font-face{font-family:'Archivo';font-style:normal;font-weight:600;font-display:swap;src:url('/fonts/archivo-600.woff2') format('woff2');}
@font-face{font-family:'Archivo';font-style:normal;font-weight:700;font-display:swap;src:url('/fonts/archivo-700.woff2') format('woff2');}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/fonts/plexmono-400.woff2') format('woff2');}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;src:url('/fonts/plexmono-500.woff2') format('woff2');}
```

In `frontend/index.html`: delete lines 6-11 (both `preconnect` links and the css2 stylesheet link). In `frontend/src/main.tsx`: add `import "./styles/fonts.css";` immediately before the existing `import "./styles.css";`.

Note: Fraunces is NOT downloaded — it is being dropped. Until Task 2 removes `--f-display`, the wordmark will render its serif fallback (Georgia); that one-commit cosmetic gap is acceptable.

- [ ] **Step 5: Verify**

Run: `cd frontend && npx vitest run tests/indexHtml.test.ts && npm test && npm run build`
Expected: guard test passes; full suite passes; build output contains the 6 woff2 files under `dist`-equivalent (`app/static/dashboard/fonts/`).

- [ ] **Step 6: Commit**

```bash
git add frontend/public/fonts frontend/src/styles/fonts.css frontend/index.html frontend/src/main.tsx frontend/tests/indexHtml.test.ts
git commit -m "feat(theme): self-host Archivo + IBM Plex Mono, drop Google Fonts"
```

---

### Task 2: Semantic token block + base chrome recolor

**Files:**
- Modify: `frontend/src/styles/mapWorkspace.css` (token block lines 1-18 + the regions listed below)

- [ ] **Step 1: Replace the `.mc-scope` token block (lines 1-18) with:**

```css
.mc-scope{
  --surface:#FFFFFF; --surface-raised:#F6F9FA; --surface-sunken:#EEF2F5;
  --border:#D5DEE4; --border-strong:#C3CFD8;
  --text-strong:#16232B; --text:#3D4C57; --text-dim:#8A99A3;
  --accent:#0B6E99; --accent-deep:#095A7E;
  --accent-soft:rgba(11,110,153,.10); --accent-halo:rgba(11,110,153,.30);
  --danger:#B3402E; --danger-soft:rgba(179,64,46,.12);
  --ok:#3FA46B;
  --scrim:rgba(255,255,255,0.25);
  --slate:#74858E; --slate-soft:rgba(116,133,142,0.20);
  --graphite:#3A3F46;
  --panel-width:clamp(360px,34vw,420px);
  --panel-rail:84px;
  --f-ui:'Archivo','Helvetica Neue',system-ui,sans-serif;
  --f-mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
  font-family:var(--f-ui);
  color:var(--text-strong);
  color-scheme:light;
  -webkit-font-smoothing:antialiased;
}
```

(Deleted: `--paper/--land/--water/--park/--road/--road-mid/--maplabel` — legacy map-mock vars; only `--paper` had a live use (`.mc-frame` background, handled below). Deleted `--ink/--ink-raise/--ink-soft/--line/--line-2/--dim/--faint/--clay*/--f-display`.)

- [ ] **Step 2: Apply the substitution table across the WHOLE file**

Mechanical substitutions (every occurrence, all 523 lines — grep each old token/hex to confirm zero remain):

| Old | New |
|---|---|
| `var(--ink-raise)` | `var(--surface-raised)` |
| `var(--ink-soft)` | `var(--surface-sunken)` |
| `var(--ink)` | `var(--surface)` (except `.pin .tag`/`.mc-pin-tag` backgrounds → `var(--text-strong)` — dark tag chips stay readable both themes) |
| `var(--line-2)` | `var(--border-strong)` |
| `var(--line)` | `var(--border)` |
| `var(--text)` | `var(--text-strong)` |
| `var(--dim)` | `var(--text)` |
| `var(--faint)` | `var(--text-dim)` |
| `var(--clay-deep)` | `var(--accent-deep)` |
| `var(--clay-soft)` | `var(--accent-soft)` |
| `var(--clay-halo)` | `var(--accent-halo)` |
| `var(--clay)` | `var(--accent)` |
| `var(--paper)` | `var(--surface-sunken)` |
| `var(--f-display)` | `var(--f-ui)` (then set `.mc-wordmark` font-weight:700) |
| `#1B1E22`, `#1C1F23`, `#2A2E33`, `#2B3036`, `#3A3F46` *as text colors* | `var(--text-strong)` |
| `#5A6068` | `var(--text)` |
| `#7E848B`, `#8b9097`, `#8b8f96`, `#9aa0a6`, `#9c988b` | `var(--text-dim)` |
| `#F0EEE8` (backgrounds) | `var(--surface-sunken)` |
| `#E1DED5`, `#e1ded5`, `#D8D2C6` (borders) | `var(--border)` |
| `#1F2328` (table bg) | `var(--surface-raised)` |
| `#9B3E2D`, `#a33a33`, `#E8A98F` (error text) | `var(--danger)` |
| `#f0c1c1` (error border) | `var(--danger-soft)` |
| `#3FA46B` (status dot) | `var(--ok)` |
| `rgba(255,255,255,.03)` … `.09)` (hover/soft fills on dark) | `var(--surface-sunken)` |
| `rgba(255,255,255,.10)` … `.28)` (tracks/handles/knob strokes on dark) | `var(--border)` (or `var(--border-strong)` where it was `.22`+) |
| `rgba(205,106,69,.X)` (all clay alphas) | `var(--accent-soft)` for ≤.2 fills; `var(--accent)` for borders ≥.4; `var(--accent-halo)` for halo/pulse |
| `rgba(116,133,142,.X)` | keep (slate family, unchanged) |
| `rgba(20,24,28,.07/.08/.09)` (hairline borders on white) | `var(--border)` |

Where "text on accent" appears (`color:#fff` on `--accent-deep` buttons like `.mc-addpin`, `.mc-cta`, `.mc-search-go`, `.mc-assistant-form button`, `.mc-assistant-msg.is-user`): keep `#fff` — white-on-accent passes AA for both accent values.

- [ ] **Step 3: Rewrite the judgment regions (not mechanical — exact replacements):**

```css
/* frame + topbar */
.mc-frame{position:relative;width:100vw;height:100vh;overflow:hidden;background:var(--surface-sunken);border-radius:0;box-shadow:none;}
.mc-topbar{position:absolute;top:0;left:0;right:0;height:60px;z-index:40;
  display:flex;align-items:center;justify-content:space-between;padding:0 22px;
  background:linear-gradient(180deg,var(--scrim),transparent);}
.mc-logo{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--accent);box-shadow:0 6px 14px -6px rgba(0,0,0,.25);}
.mc-wordmark{font-family:var(--f-ui);font-weight:700;font-size:20px;letter-spacing:-0.01em;color:var(--text-strong);}
.mc-status{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:var(--text-strong);
  background:var(--surface);border:1px solid var(--border);padding:7px 13px;border-radius:999px;}

/* workspace panel — flat light surface, no gradient */
.mc-workspace-panel{position:absolute;top:0;right:0;bottom:0;z-index:1200;width:var(--panel-width);height:auto;
  background:var(--surface);border-left:1px solid var(--border);border-radius:0;
  box-shadow:-18px 0 40px -28px rgba(16,24,32,.25);
  display:flex;flex-direction:column;animation:panelin .55s cubic-bezier(.2,.8,.2,1) both;}
.mc-handle::before{content:"";width:5px;height:46px;border-radius:99px;background:var(--border-strong);}
.mc-handle:hover::before,.mc-handle:focus-visible::before{background:var(--accent);}

/* tabs */
.mc-tab{...same layout props...;color:var(--text);}
.mc-tab:hover{color:var(--text-strong);background:var(--surface-sunken);}
.mc-tab.is-active{color:var(--accent-deep);font-weight:600;}
.mc-tab.is-active::after{background:var(--accent);}
.mc-tab .pill{font-family:var(--f-mono);font-size:11px;background:var(--surface-sunken);color:var(--text);padding:1px 7px;border-radius:99px;}

/* cards, chips, selected states */
.mc-card{...;background:var(--surface-raised);border:1px solid var(--border);}
.mc-card.on{background:var(--accent-soft);border-color:var(--accent);}
.mc-card .chk{...;border:1.5px solid var(--border-strong);}
.mc-card.on .chk{background:var(--accent);border-color:var(--accent);}
.mc-chip.on{color:#fff;background:var(--accent);border-color:var(--accent);}
.mc-tinybtn.on{color:#fff;background:var(--accent);border-color:var(--accent);}
.mc-snaps button.on{color:var(--accent-deep);} .mc-snaps button.on b{background:var(--accent);width:20px;}

/* sticky bars/gradients */
.mc-querybar{...;background:var(--surface);border-bottom:1px solid var(--border);backdrop-filter:none;}
.mc-compare-actions{...;background:linear-gradient(180deg,rgba(255,255,255,0),var(--surface) 42%);}

/* verdict tones — accent replaces clay; slate stays */
.mc-verdict.tone-hot{background:var(--accent-soft);border-color:var(--accent-soft);border-left-color:var(--accent);}
.mc-verdict.tone-hot .mc-ratio{color:var(--accent-deep);}
.mc-verdict.tone-hot .mc-spark span{background:var(--accent-halo);}

/* inputs */
.mc-inp{...;background:var(--surface);border:1px solid var(--border);color:var(--text-strong);}
input.mc-inp{display:block;}  /* drop color-scheme:dark — handled by .mc-scope/theme */
input.mc-inp:focus,.mc-draft input:focus{outline:2px solid var(--accent-soft);outline-offset:1px;}

/* modal (mc-modal-tab.on) */
.mc-modal-tab.on{color:#fff;background:var(--accent);border-color:var(--accent);}
```

Apply the same treatment to every remaining rule the substitution table touches (`.mc-assistant-*` for now stays in place — its relocation is Task 9 but its colors convert here; `.mc-draft`, `.mc-search--sheet`, `.mc-results`, `.mc-methods*`, `.mc-icard*`, `.mc-ranked*`, `.mc-plot*`, `.mc-temporal*`, `.mc-cat-*`, `.mc-cmpset*`, `.mc-vchip`, `.mc-banner`, `.mc-error`, `.mc-empty`, `.mc-legend`, `.mc-helper`, `.mc-disclosure` — after conversion, grep the file: **zero** `--ink|--line|--clay|--dim(?!ension)|--faint|--paper|--f-display` references and zero raw hexes outside the token block, `#fff`/`#FFFFFF`-on-accent, and the two data-mark constants may remain).

- [ ] **Step 4: Update the CSS-content test + run the suite**

`frontend/tests/mapWorkspaceStyle.test.ts` asserts `color:var(--text)` on `.mc-incident-table` rules and `color:#fff` on `th` — update expectations: table text `var(--text-strong)`, `th` color `var(--text-strong)` with `background:var(--surface-sunken)` (rewrite the `th` rule accordingly in the sweep). Keep the readability *intent* of the test: it should assert the table uses token-based colors, not literals.

Run: `cd frontend && npm test && npm run build`
Expected: all green. Then a quick visual sanity: `npm run dev` is NOT needed — the live check happens in Task 7.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/mapWorkspace.css frontend/tests/mapWorkspaceStyle.test.ts
git commit -m "feat(theme): Civic Clear semantic tokens — light-surface recolor of the shell"
```

---

### Task 3: Fold `styles.css` into the token system

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Replace the `:root` block (lines 1-12) with:**

```css
:root{
  color-scheme:light;
  color:#16232B;
  background:#EEF2F5;
  font-family:'Archivo','Helvetica Neue',system-ui,sans-serif;
  font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;
}
[data-theme="dark"]{color-scheme:dark;color:#E8EDF2;background:#151C23;}
```

(This file styles pre-`.mc-scope` chrome — body/base + the PlaceForm/BulkPlaceEntry modals; it can't use `.mc-scope`-scoped vars, so it gets the two literal base values plus a dark override. The modal rules below CAN use the vars when rendered inside `.mc-scope` — check where PlaceForm renders: if inside `.mc-scope` (it is — the modal scrim is `.mc-modal-scrim` in mapWorkspace.css), convert the teal accents.)

- [ ] **Step 2: Convert the legacy accents**

In the remaining rules: `#146c72`/teal accent occurrences → `var(--accent)`; grays → the nearest token (`var(--text)`, `var(--border)`, `var(--surface-sunken)`); leave structural rules (box-sizing, resets) untouched. After conversion: `grep -nE "#[0-9a-fA-F]{3,6}" frontend/src/styles.css` should show only the two `:root`/dark literals above.

- [ ] **Step 3: Verify + commit**

Run: `cd frontend && npm test && npm run build` — green.

```bash
git add frontend/src/styles.css
git commit -m "feat(theme): fold legacy styles.css into the token system"
```

---

### Task 4: `[data-theme="dark"]` override block

**Files:**
- Modify: `frontend/src/styles/mapWorkspace.css` (append after the `.mc-scope` token block)

- [ ] **Step 1: Append the dark override block**

```css
[data-theme="dark"] .mc-scope{
  --surface:#1B232B; --surface-raised:#151C23; --surface-sunken:#232C35;
  --border:#2C3742; --border-strong:#3A4754;
  --text-strong:#E8EDF2; --text:#B9C6D0; --text-dim:#7C8B99;
  --accent:#4FB3D9; --accent-deep:#7BC8E4;
  --accent-soft:rgba(79,179,217,.14); --accent-halo:rgba(79,179,217,.35);
  --danger:#F0937B; --danger-soft:rgba(240,147,123,.16);
  --ok:#5BBF87;
  --scrim:rgba(0,0,0,0.25);
  color-scheme:dark;
}
```

Note `--graphite`/`--slate`/`--slate-soft` are deliberately NOT overridden — data marks stay identical in both themes (product invariant). White-on-accent buttons: `#fff` on `#4FB3D9` is ~2.1:1 — FAILS AA. Therefore also add:

```css
[data-theme="dark"] .mc-scope .mc-addpin,
[data-theme="dark"] .mc-scope .mc-cta,
[data-theme="dark"] .mc-scope .mc-search-go,
[data-theme="dark"] .mc-scope .mc-assistant-form button,
[data-theme="dark"] .mc-scope .mc-chip.on,
[data-theme="dark"] .mc-scope .mc-tinybtn.on,
[data-theme="dark"] .mc-scope .mc-modal-tab.on,
[data-theme="dark"] .mc-scope .mc-assistant-msg.is-user{color:#0B1218;}
```

(dark text on the bright dark-theme accent — AA-compliant; one grouped rule, no per-component branching.)

- [ ] **Step 2: Contrast matrix check (scriptable)**

Write a quick throwaway check (run with `node`, not committed): compute WCAG contrast for the pairs (text-strong/surface, text/surface, text-dim/surface-raised, accent-deep/surface, #fff/accent light, #0B1218/accent dark) for both themes; every text pair must be ≥ 4.5, large-text/UI pairs ≥ 3.0. If a pair fails, adjust the VALUE in the token block (not the semantics) and note it in the commit body.

- [ ] **Step 3: Manual smoke via devtools**

Run `npm run build`, start the worktree uvicorn (`.venv/bin/uvicorn app.main:app --port 8020`), open the app, and in devtools run `document.documentElement.setAttribute("data-theme","dark")` — the shell must flip to dark surfaces (the MAP stays light; that's Task 6). Screenshot both states for the task report.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/mapWorkspace.css
git commit -m "feat(theme): dark-theme token overrides with AA-safe on-accent text"
```

---

### Task 5: `useTheme` + `ThemeToggle` (TDD)

**Files:**
- Create: `frontend/src/lib/useTheme.ts`, `frontend/src/components/ThemeToggle.tsx`
- Test: `frontend/src/lib/useTheme.test.ts`, `frontend/src/components/ThemeToggle.test.tsx`

- [ ] **Step 1: Write the failing hook tests**

```ts
// frontend/src/lib/useTheme.test.ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTheme } from "./useTheme";

function mockMatchMedia(dark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: dark,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: vi.fn(),
  }));
  return { fire: (matches: boolean) => listeners.forEach((cb) => cb({ matches })) };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("useTheme", () => {
  it("defaults to the OS scheme when nothing is stored", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("prefers the stored explicit choice over the OS scheme", () => {
    mockMatchMedia(true);
    localStorage.setItem("wp-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("persists an explicit choice and applies the attribute", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("dark"));
    expect(localStorage.getItem("wp-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows OS changes only while no explicit choice is stored", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => media.fire(true));
    expect(result.current.theme).toBe("dark");
    act(() => result.current.setTheme("light"));
    act(() => media.fire(true));
    expect(result.current.theme).toBe("light"); // explicit choice wins
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/useTheme.test.ts` → module missing.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/useTheme.ts
import { useCallback, useEffect, useState } from "react";

export type ThemeName = "light" | "dark";
const STORAGE_KEY = "wp-theme";

function stored(): ThemeName | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function osTheme(): ThemeName {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(() => stored() ?? osTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const onChange = (event: { matches: boolean }) => {
      if (stored() === null) setThemeState(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
```

- [ ] **Step 4: ThemeToggle (test then component)**

```tsx
// frontend/src/components/ThemeToggle.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./ThemeToggle";

afterEach(cleanup);

describe("ThemeToggle", () => {
  it("labels the action it will take and reports pressed state", () => {
    const onChange = vi.fn();
    render(<ThemeToggle theme="light" onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Switch to dark theme" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("inverts for dark", () => {
    const onChange = vi.fn();
    render(<ThemeToggle theme="dark" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(onChange).toHaveBeenCalledWith("light");
  });
});
```

```tsx
// frontend/src/components/ThemeToggle.tsx
import type { ThemeName } from "../lib/useTheme";

type Props = { theme: ThemeName; onChange: (next: ThemeName) => void };

export function ThemeToggle({ theme, onChange }: Props) {
  const next: ThemeName = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="mc-themetoggle"
      aria-pressed={theme === "dark"}
      aria-label={`Switch to ${next} theme`}
      onClick={() => onChange(next)}
    >
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      )}
    </button>
  );
}
```

CSS (append to mapWorkspace.css near `.mc-status`):

```css
.mc-themetoggle{display:grid;place-items:center;width:32px;height:32px;border-radius:999px;cursor:pointer;
  color:var(--text-strong);background:var(--surface);border:1px solid var(--border);}
.mc-themetoggle:hover{border-color:var(--border-strong);}
```

- [ ] **Step 5: Run both test files + full suite; commit**

```bash
git add frontend/src/lib/useTheme.ts frontend/src/lib/useTheme.test.ts frontend/src/components/ThemeToggle.tsx frontend/src/components/ThemeToggle.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(theme): useTheme hook + ThemeToggle"
```

---

### Task 6: `mapLayers.ts` extraction + themed map with `style.load` re-registration

**Files:**
- Create: `frontend/src/lib/mapLayers.ts` (moved code — content is already reviewed/shipped)
- Modify: `frontend/src/components/MapCanvas.tsx`, `frontend/src/components/MapCanvas.test.tsx`

- [ ] **Step 1: Extract (pure move).** Move from `MapCanvas.tsx` into `frontend/src/lib/mapLayers.ts`, exporting: `BEATS_SOURCE`, `RINGS_SOURCE`, `INCIDENTS_SOURCE`, `CLUSTER_MAX_ZOOM`, `EMPTY_FC`, `addBeatLayers`, `addRingLayers`, `addIncidentLayers`, `incidentCardElement`, plus a new aggregate:

```ts
export function registerDataLayers(map: maplibregl.Map): void {
  addBeatLayers(map);
  addRingLayers(map);
  addIncidentLayers(map);
}
```

Keep the code byte-identical otherwise (imports adjusted: `maplibregl` type import, `circlePolygonCoords` NOT needed here — `ringsGeoJSON` stays in MapCanvas since it's data, not layers). MapCanvas imports what it needs from `../lib/mapLayers`. The invariant comment ("one calm neutral… never severity colors") moves with the code.

- [ ] **Step 2: Write the failing swap tests** (extend `MapCanvas.test.tsx`; the mock already stores `sources`/`layers` and fires `load` immediately — add `style.load` support):

In the maplibre mock's MockMap: `setStyle = vi.fn(function (this: MockMap) { this.sources.clear(); this.layers = []; for (const cb of this.handlers["style.load"] ?? []) cb(); });` and make `on("style.load", cb)` NOT fire immediately (only `load` does). Also fire `style.load` handlers once inside the constructor-immediate `load` path? No — instead the component now registers layers via `style.load`; make the mock fire `style.load` listeners immediately upon registration (same trick as `load`), so initial registration still happens synchronously in tests:

```ts
    on(event: string, layerOrCb: unknown, maybeCb?: (arg?: unknown) => void) {
      // ...existing layer-scoped branch...
      const cb = layerOrCb as (arg?: unknown) => void;
      (this.handlers[event] ??= []).push(cb);
      if (event === "load" || event === "style.load") cb();
      return this;
    }
```

New tests:

```tsx
  it("re-registers data layers and re-feeds data after a theme swap", async () => {
    const { rerender } = renderCanvas({ incidentPoints: POINTS_FC, beats: BEATS_FC, theme: "light" });
    await waitFor(() => expect(MockedMap.last!.sources.get("mc-incidents")).toBeTruthy());
    rerender(/* same props but theme: "dark" */);
    await waitFor(() => {
      expect(MockedMap.last!.setStyle).toHaveBeenCalledTimes(1);
      // setStyle cleared sources; style.load re-registered and effects re-fed:
      const incidents = MockedMap.last!.sources.get("mc-incidents");
      expect(incidents).toBeTruthy();
      expect(incidents!.setData).toHaveBeenCalledWith(POINTS_FC);
      const beats = MockedMap.last!.sources.get("mc-beats");
      expect(beats!.setData).toHaveBeenCalledWith(BEATS_FC);
    });
  });

  it("passes the theme to the style builder", async () => {
    renderCanvas({ theme: "dark" });
    await waitFor(() => expect(MockedMap.last).not.toBeNull());
    // buildMapStyle imported real — assert via the style handed to the Map constructor:
    // capture constructor arg in the mock (add `static lastOptions` set in constructor)
    expect((MockedMap as any).lastOptions.style.sources.protomaps.url).toContain("pmtiles://");
  });
```

(Adapt the renderCanvas helper: `theme: "light"` default; `rerender` must be used with the full prop set — mirror the existing selection-change test's pattern. Add `static lastOptions` to MockMap capturing the constructor options.)

- [ ] **Step 3: Implement in MapCanvas**

- Props: add `theme: MapTheme` (required).
- Init effect: unchanged except (a) style chosen with `theme` instead of `"light"` (`buildMapStyle(theme, origin)` / `fallbackMapStyle(theme)`), (b) replace the `map.on("load", () => { addBeatLayers(map); addRingLayers(map); addIncidentLayers(map); setMapReady(true); })` layer-registration with:

```tsx
      map.on("style.load", () => {
        registerDataLayers(map);
        setStyleEpoch((n) => n + 1);
      });
      map.on("load", () => setMapReady(true));
```

- New state `const [styleEpoch, setStyleEpoch] = useState(0);` — the beats/highlight/incidents/rings `setData`/`setFilter` effects add `styleEpoch` to their dep arrays (they re-run after each swap; `mapReady` stays in the deps for the initial gate).
- Theme-change effect (init effect keeps `[]` deps — track theme via ref to avoid re-creating the map):

```tsx
  const themeRef = useRef(theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || themeRef.current === theme) return;
    themeRef.current = theme;
    if (import.meta.env.VITE_MAP_BASEMAP === "carto") return; // escape hatch stays light-only
    map.setStyle(tilesMissingRef.current ? fallbackMapStyle(theme) : buildMapStyle(theme, window.location.origin));
  }, [theme, mapReady]);
```

(`tilesMissingRef` — a ref mirror of the existing `tilesMissing` state, set where it's set; the init effect also sets `themeRef.current = theme` at construction so the initial theme never triggers a redundant swap.)

- [ ] **Step 4: Run the suite** — `cd frontend && npm test && npm run lint` — all green (MapWorkspace tests: the mocked MapCanvas ignores the new required prop until Task 7 wires it — but tsc checks the REAL component render in MapWorkspace.tsx, which doesn't pass `theme` yet. To keep this task green: wire the minimal `theme="light"` literal into MapWorkspace's `<MapCanvas ... theme="light" />` in THIS task; Task 7 replaces the literal with the hook value.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mapLayers.ts frontend/src/components/MapCanvas.tsx frontend/src/components/MapCanvas.test.tsx frontend/src/components/MapWorkspace.tsx
git commit -m "feat(theme): themed map with style.load re-registration; extract mapLayers"
```

---

### Task 7: Wire theme through MapWorkspace + mid-branch live checkpoint

**Files:**
- Modify: `frontend/src/components/MapWorkspace.tsx`, `frontend/src/components/MapWorkspace.test.tsx`

- [ ] **Step 1:** In MapWorkspace: `const { theme, setTheme } = useTheme();` — pass `theme={theme}` to `<MapCanvas>` (replacing the Task-6 literal) and add `<ThemeToggle theme={theme} onChange={setTheme} />` to `.mc-topbar-right` after the session chip. Imports accordingly.

- [ ] **Step 2:** Test: add to MapWorkspace.test.tsx a case asserting the toggle renders and flips the attribute:

```tsx
  it("theme toggle flips the document theme attribute", async () => {
    // ...standard render with mocked client...
    const toggle = await screen.findByRole("button", { name: /switch to (dark|light) theme/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toMatch(/dark|light/));
  });
```

(localStorage is shimmed in testSetup; clear `wp-theme` + the attribute in the suite's beforeEach/afterEach to avoid cross-test bleed.)

- [ ] **Step 3: Live checkpoint (both themes).** `npm run build`, run the worktree uvicorn on :8020, and verify in the browser: toggle → whole shell + MAP flip together; beat outlines/dots survive the flip (re-registration); fonts load from `/fonts/` (network tab: zero external requests). Screenshot light + dark for the report. Fix anything found before committing.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx
git commit -m "feat(theme): night mode live — toggle wired through shell and map"
```

---

## STAGE 2 — EVOLVED WORKSPACE LAYOUT

### Task 8: SearchPill replaces the Add Pin control

**Files:**
- Create: `frontend/src/components/SearchPill.tsx` + `SearchPill.test.tsx`
- Modify: `frontend/src/components/MapWorkspace.tsx` (swap `.mc-controls` block), `frontend/src/styles/mapWorkspace.css` (pill styles; retire `.mc-actionrow`/`.mc-addpin` rules), `frontend/src/components/MapWorkspace.test.tsx` (Add-pin interactions now go through the pill)

- [ ] **Step 1: Failing component tests**

```tsx
// frontend/src/components/SearchPill.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchPill } from "./SearchPill";
import type { GeocodeResult } from "../types";

const RESULT: GeocodeResult = { label: "8800 Delridge Way SW", latitude: 47.52, longitude: -122.36, source: "nominatim" };
const search = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset().mockResolvedValue([RESULT]);
  localStorage.clear();
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  cleanup();
});

describe("SearchPill", () => {
  it("searches after the debounce and reports the selected result", async () => {
    const onSelect = vi.fn();
    render(<SearchPill search={search} onSelect={onSelect} addPinMode={false} onToggleAddPin={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: /search address/i }), { target: { value: "8800 Del" } });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.click(await screen.findByRole("option", { name: /8800 Delridge/i }));
    expect(onSelect).toHaveBeenCalledWith(RESULT);
  });

  it("arms pin-drop mode via the pin button", () => {
    const onToggleAddPin = vi.fn();
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode={false} onToggleAddPin={onToggleAddPin} />);
    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    expect(onToggleAddPin).toHaveBeenCalled();
    // pressed state reflects armed mode
    cleanup();
    render(<SearchPill search={search} onSelect={vi.fn()} addPinMode onToggleAddPin={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Drop a pin on the map" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2:** Run — FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// frontend/src/components/SearchPill.tsx
import { useId, useState } from "react";

import { useAddressSearch } from "../lib/useAddressSearch";
import type { GeocodeResult } from "../types";

type Props = {
  search: (query: string, signal?: AbortSignal) => Promise<GeocodeResult[]>;
  onSelect: (result: GeocodeResult) => void;
  addPinMode: boolean;
  onToggleAddPin: () => void;
};

export function SearchPill({ search, onSelect, addPinMode, onToggleAddPin }: Props) {
  const { query, setQuery, results, status, rememberPlace } = useAddressSearch(search);
  const [open, setOpen] = useState(false);
  const listId = useId();

  function select(result: GeocodeResult) {
    rememberPlace(result);
    setQuery("");
    setOpen(false);
    onSelect(result);
  }

  return (
    <div className="mc-searchpill">
      <div className="mc-searchpill-row">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
        <input
          role="combobox"
          aria-label="Search address or place"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          placeholder="Search address or drop a pin"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        <button
          type="button"
          className={`mc-searchpill-pin${addPinMode ? " is-armed" : ""}`}
          aria-pressed={addPinMode}
          aria-label="Drop a pin on the map"
          onClick={onToggleAddPin}
        >
          <svg viewBox="0 0 24 32" width="13" height="16"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="currentColor" /></svg>
        </button>
      </div>
      {open && results.length > 0 ? (
        <ul className="mc-searchpill-results" id={listId} role="listbox">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude}`}>
              <button type="button" role="option" aria-selected={false} onClick={() => select(result)}>
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {status === "error" ? <p className="mc-searchpill-msg" role="status">Search is unavailable right now.</p> : null}
    </div>
  );
}
```

(Verify `useAddressSearch`'s exact return names — `query/setQuery/results/status/rememberPlace` per `frontend/src/lib/useAddressSearch.ts`; adapt property names to the real API if they differ, keeping the behavior. If `rememberPlace` lives elsewhere, call it exactly as `AddressLookup`/`PlaceSearch` do.)

CSS (replace the `.mc-controls`/`.mc-actionrow`/`.mc-addpin` region; keep `.mc-helper` for the armed hint):

```css
.mc-searchpill{position:absolute;top:74px;left:22px;z-index:1100;width:min(360px,calc(100vw - var(--panel-width) - 44px));display:grid;gap:8px;}
.mc-searchpill-row{display:flex;align-items:center;gap:9px;height:44px;padding:0 6px 0 14px;border-radius:999px;
  background:var(--surface);border:1px solid var(--border);box-shadow:0 10px 26px -14px rgba(16,24,32,.3);color:var(--text-dim);}
.mc-searchpill-row input{border:0;background:transparent;outline:none;width:100%;font-family:var(--f-ui);font-size:14px;color:var(--text-strong);}
.mc-searchpill-row input::placeholder{color:var(--text-dim);}
.mc-searchpill-pin{display:grid;place-items:center;width:34px;height:34px;border-radius:999px;border:0;cursor:pointer;color:#fff;background:var(--accent);}
[data-theme="dark"] .mc-scope .mc-searchpill-pin{color:#0B1218;}
.mc-searchpill-pin.is-armed{box-shadow:0 0 0 4px var(--accent-soft);animation:armpulse 2.4s ease-in-out infinite;}
.mc-searchpill-results{list-style:none;margin:0;padding:6px;display:grid;gap:2px;max-height:240px;overflow:auto;
  background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 30px -16px rgba(16,24,32,.35);}
.mc-searchpill-results button{width:100%;text-align:left;border:0;background:transparent;cursor:pointer;padding:9px 10px;border-radius:8px;
  font-family:var(--f-ui);font-size:13px;color:var(--text-strong);}
.mc-searchpill-results button:hover{background:var(--surface-sunken);}
.mc-searchpill-msg{margin:0;font-size:12px;color:var(--text-dim);}
@keyframes armpulse{0%,100%{box-shadow:0 0 0 4px var(--accent-soft);}50%{box-shadow:0 0 0 8px transparent;}}
```

(The old `armpulse` keyframes get replaced by this accent version; delete the clay one.)

- [ ] **Step 4: Wire MapWorkspace.** Replace the whole `.mc-controls` block (lines 347-362) with:

```tsx
        <SearchPill
          search={(query, signal) => geocodingProvider.search(query, signal)}
          onSelect={handleLookup}
          addPinMode={pinDraft.addPinMode}
          onToggleAddPin={() => (pinDraft.addPinMode ? pinDraft.setAddPinMode(false) : pinDraft.startAddPin())}
        />
        {pinDraft.addPinMode ? (
          <div className="mc-helper" role="status"><span className="cross" />Click the map to drop a pin - Esc to cancel</div>
        ) : null}
```

(Check how `geocodingProvider` exposes search — read the `AddressLookup`/`PlaceSearch` usage (`PlaceSearch provider={geocodingProvider}`) and match: if PlaceSearch takes a provider object and builds the search fn internally, mirror that construction here; the pill's `search` prop signature matches `useAddressSearch`'s expected fn. Also: `.mc-helper` needs a positioned parent now that `.mc-controls` is gone — give `.mc-helper` `position:absolute;top:126px;left:22px;z-index:1100;` in the CSS.)

Update `MapWorkspace.test.tsx`: the two "Add pin" flows now click `getByRole("button", { name: "Drop a pin on the map" })` instead of the old "Add pin" name; the `is-placing-pin` class assertions stay valid.

- [ ] **Step 5:** Full suite + lint + build green. Commit:

```bash
git add frontend/src/components/SearchPill.tsx frontend/src/components/SearchPill.test.tsx frontend/src/components/MapWorkspace.tsx frontend/src/components/MapWorkspace.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(shell): search pill absorbs pin-drop; Add Pin button retired"
```

---

### Task 9: Analyst dock in the workspace panel

**Files:**
- Modify: `frontend/src/components/AssistantPanel.tsx` (dock chrome: collapse, explainer, quick chips), `frontend/src/components/BottomSheet.tsx` (dock slot), `frontend/src/components/MapWorkspace.tsx` (move the render), `frontend/src/styles/mapWorkspace.css` (dock styles; retire floating `.mc-assistant` positioning), tests: `AssistantPanel.test.tsx` additions, `BottomSheet.test.tsx` untouched-or-minor

- [ ] **Step 1: Failing tests (append to AssistantPanel.test.tsx)**

```tsx
  it("shows the explainer and quick actions when empty, and a chip sends its prompt", async () => {
    streamMock.mockResolvedValue(undefined); // reuse the file's existing streamAssistantChat mock
    render(<AssistantPanel dashboardState={dashboardState} onToolResult={vi.fn()} />);
    expect(screen.getByText("Ask about what the map is showing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What's near this pin?" }));
    await waitFor(() => expect(streamMock).toHaveBeenCalled());
    const payload = streamMock.mock.calls[0][0];
    expect(payload.messages.at(-1)).toEqual({ role: "user", content: "What's near this pin?" });
    expect(payload.dashboard_state).toBe(dashboardState);
  });

  it("collapses to the header only", () => {
    render(<AssistantPanel dashboardState={dashboardState} onToolResult={vi.fn()} />);
    const collapse = screen.getByRole("button", { name: /collapse analyst/i });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(screen.queryByLabelText("Analyst message")).toBeNull();
    expect(screen.getByRole("button", { name: /expand analyst/i })).toHaveAttribute("aria-expanded", "false");
  });
```

(Read the existing test file's mock naming for `streamAssistantChat` and reuse it — the file already mocks the client.)

- [ ] **Step 2:** Run — FAIL (no explainer/chips/collapse yet).

- [ ] **Step 3: Implement in AssistantPanel**

- Add state `const [collapsed, setCollapsed] = useState(false);`
- Root element becomes `<aside className="mc-dock" aria-label="Analyst">`.
- Header: title + status + collapse button:

```tsx
      <div className="mc-dock-head">
        <h3><span className="mc-dock-dot" />Analyst</h3>
        <span>{sending ? "Working" : "Ready"}</span>
        <button
          type="button"
          className="mc-dock-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand analyst" : "Collapse analyst"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d={collapsed ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
        </button>
      </div>
```

- Everything below the header wraps in `{collapsed ? null : (<>…log, tools, error, form…</>)}`.
- Empty state (replacing the bare "No messages"):

```tsx
        {messages.length === 0 && !draft ? (
          <div className="mc-dock-empty">
            <p>Ask about what the map is showing</p>
            <div className="mc-dock-chips">
              {["What's near this pin?", "Compare my places"].map((prompt) => (
                <button key={prompt} type="button" className="mc-chip" disabled={sending}
                  onClick={() => void sendTurn([...messages, { role: "user", content: prompt }])}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
```

(The old `.mc-assistant-*` class names inside the component rename to `.mc-dock-*` equivalents — head/log/msg/empty/tools/error/form — keeping the aria labels IDENTICAL: "Analyst message", "Send", "Retry", aria-live log.)

- [ ] **Step 4: Dock slot in BottomSheet + move the render**

BottomSheet: add an optional `dock?: ReactNode` prop; render after `.mc-panels`:

```tsx
      <div className="mc-panels">{children}</div>
      {dock ? <div className="mc-dock-slot">{dock}</div> : null}
```

(When collapsed to the rail, the dock hides like `.mc-panels` does — CSS below.)

MapWorkspace: delete the floating `<AssistantPanel …/>` render (line 372) and pass it into BottomSheet instead:

```tsx
        <BottomSheet
          ...existing props...
          dock={<AssistantPanel dashboardState={assistantState} onToolResult={applyAssistantToolResult} />}
        >
```

CSS: delete the `.mc-assistant{position:absolute;left:22px;bottom:22px;…}` block and its `.mc-assistant` z-index membership at the late override (line 398) and its mobile override (line 409); add:

```css
.mc-dock-slot{flex:none;border-top:1px solid var(--border);background:var(--surface);}
.mc-workspace-panel.is-collapsed .mc-dock-slot{display:none;}
.mc-dock{display:grid;gap:10px;padding:12px 16px;max-height:44vh;overflow:auto;}
.mc-dock-head{display:flex;align-items:center;gap:10px;}
.mc-dock-head h3{margin:0;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:var(--text-strong);}
.mc-dock-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);}
.mc-dock-head span{font-family:var(--f-mono);font-size:10.5px;color:var(--text-dim);margin-right:auto;}
.mc-dock-collapse{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;}
.mc-dock-log{display:grid;gap:7px;max-height:200px;overflow:auto;}
.mc-dock-msg{margin:0;padding:8px 10px;border-radius:10px;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere;}
.mc-dock-msg.is-user{margin-left:34px;color:#fff;background:var(--accent);}
[data-theme="dark"] .mc-scope .mc-dock-msg.is-user{color:#0B1218;}
.mc-dock-msg.is-assistant{margin-right:22px;color:var(--text-strong);background:var(--surface-sunken);border:1px solid var(--border);}
.mc-dock-empty{display:grid;gap:9px;}
.mc-dock-empty p{margin:0;color:var(--text-dim);font-size:12.5px;}
.mc-dock-chips{display:flex;flex-wrap:wrap;gap:7px;}
.mc-dock-tools{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none;}
.mc-dock-tools li{font-family:var(--f-mono);font-size:10.5px;color:var(--accent-deep);background:var(--accent-soft);border:1px solid var(--accent-soft);border-radius:999px;padding:4px 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.mc-dock-error{margin:0;color:var(--danger);font-size:12px;font-weight:650;}
.mc-dock-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;}
.mc-dock-form textarea{min-height:42px;max-height:84px;resize:vertical;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text-strong);font-family:var(--f-ui);font-size:12.5px;padding:9px 10px;}
.mc-dock-form button{height:42px;padding:0 13px;border:0;border-radius:10px;cursor:pointer;color:#fff;background:var(--accent);font-size:12.5px;font-weight:700;}
[data-theme="dark"] .mc-scope .mc-dock-form button{color:#0B1218;}
```

(Delete the old `.mc-assistant-*` rule set entirely.)

- [ ] **Step 5:** Full suite + lint + build. Existing MapWorkspace assistant tests (`getByLabelText("Analyst message")`, "Send") keep passing — same labels, new location. Commit:

```bash
git add frontend/src/components/AssistantPanel.tsx frontend/src/components/AssistantPanel.test.tsx frontend/src/components/BottomSheet.tsx frontend/src/components/MapWorkspace.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(shell): Analyst docks into the workspace panel with quick actions"
```

---

### Task 10: Legend + zoom to bottom-right; topbar order

**Files:**
- Modify: `frontend/src/components/MapCanvas.tsx` (NavigationControl), `frontend/src/styles/mapWorkspace.css` (legend position), `frontend/src/components/MapWorkspace.test.tsx` (only if selectors changed)

- [ ] **Step 1:** In MapCanvas's init effect, after constructing the map:

```tsx
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
```

(The existing `.mc-frame .maplibregl-ctrl-bottom-right` rule already insets that corner clear of the panel — attribution and zoom will stack there; verify visually in Task 11.) Add to the MapCanvas mock: `NavigationControl: class {}` in the maplibre mock's default export, and `addControl` already exists as a no-op.

- [ ] **Step 2:** Legend CSS — replace the `.mc-legend` position (top-left, lines 81-83) with bottom-right stacking above the attribution/zoom cluster:

```css
.mc-legend{position:absolute;right:calc(var(--panel-width) + 14px);bottom:64px;z-index:40;width:212px;padding:14px 15px;border-radius:14px;
  background:var(--surface);border:1px solid var(--border);box-shadow:0 14px 30px -16px rgba(16,24,32,.3);}
```

(Delete the `.mc-frame.is-placing-pin .mc-legend{top:180px;}` rule — no longer relevant. The `@media (max-width:760px)` `.mc-legend{display:none;}` rule stays.)

- [ ] **Step 3:** Suite + build green; commit:

```bash
git add frontend/src/components/MapCanvas.tsx frontend/src/components/MapCanvas.test.tsx frontend/src/styles/mapWorkspace.css
git commit -m "feat(shell): legend + zoom control cluster bottom-right"
```

---

### Task 11: Full gate + live verification + docs

- [ ] **Step 1:** `make test-all` — all green.

- [ ] **Step 2: Live verification** (worktree uvicorn :8020; `make seed-crime`; analyze dates 2025-01-01 → 2025-10-31; seed a couple of NULL-coordinate rows if chip redaction copy needs exercising):
1. **Light theme:** shell is Civic Clear (white panel, blue accent), map light; pins/rings/dots/beats render; search pill searches and flies; pin button arms click-to-place (crosshair, Esc cancels); Analyst dock visible in the panel with explainer + chips; chip click fires an assistant turn (SSE may 404 locally — the error+Retry state appearing IS the pass criterion if no LLM is running); legend + zoom bottom-right, clear of the panel.
2. **Toggle to dark with dots + beat outlines + an analyzed ring on screen:** whole shell AND map flip; all layers survive (re-registration); popup card, disclosure chip, legend readable in dark.
3. **Reload in dark:** persists (localStorage). Clear the key, set OS emulation dark (devtools rendering emulation) → follows OS.
4. **Network audit:** zero external requests — no Google Fonts, tiles/glyphs/sprites/fonts all same-origin.
5. **Mobile width (375px):** pill fits, panel behavior unchanged, dock usable, no overflow.
6. Screenshot light + dark for the PR.

- [ ] **Step 3: Docs**
- `docs/ROADMAP.md`: tick Phase 6 Slice 3 with a one-line summary; note the carry-ins landed (`setStyle` re-registration, `mapLayers.ts` extraction).
- `docs/superpowers/specs/2026-07-05-shell-overhaul-design.md`: mark SHIPPED; record any deviations found during build.
- Update the stale "Waypoint still fetches its UI fonts from Google Fonts" follow-up chip context if it still exists (the work is now done — dismiss it in-session).

- [ ] **Step 4:** Fix anything found; re-run `make test-all`; commit:

```bash
git add -A && git commit -m "feat(shell): slice-3 live-verification fixes + docs"
```

---

## Self-review checklist

- Spec coverage: fonts+guard (T1), token rewrite light (T2), styles.css fold (T3), dark overrides + AA fix (T4), useTheme/toggle (T5), map swap + mapLayers extraction (T6), wiring + mid-branch checkpoint (T7), search pill (T8), Analyst dock + chips + collapse (T9), legend/zoom cluster (T10), live pass incl. re-registration proof + zero-external audit + mobile (T11). Invariant: data marks not themed (T4 note), copy neutral (dock explainer/chips listed verbatim).
- Placeholder scan: T1's font URLs are extracted at run time from the css2 response (documented procedure, not a TBD); T2's substitution table is exhaustive against the current file; judgment regions written out. "Verify the real API" notes (useAddressSearch names, geocodingProvider search construction, existing test mock names) are verification instructions with the fallback stated.
- Type consistency: `ThemeName`/`MapTheme` are distinct names — MapCanvas takes `MapTheme` from mapStyle.ts and MapWorkspace passes `theme` from useTheme; both are the string union "light"|"dark" so they're assignable, but T6/T7 implementers should confirm tsc accepts it (if not, re-export `MapTheme` as the single union and have useTheme use it — one-line fix). `registerDataLayers(map)` name consistent across T6 tests/impl. Dock aria labels consistent between T9 tests and impl.
