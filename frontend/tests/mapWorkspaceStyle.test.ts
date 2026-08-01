// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/mapWorkspace.css", import.meta.url), "utf8");

describe("map workspace styles", () => {
  it("keeps incident table data readable via semantic tokens", () => {
    expect(css).toMatch(/\.mc-incident-table\{[^}]*font-size:13px;[^}]*color:var\(--text-strong\);/);
    expect(css).toMatch(/\.mc-incident-table th,\.mc-incident-table td\{[^}]*color:var\(--text-strong\);/);
    expect(css).toMatch(/\.mc-incident-table th\{[^}]*font-size:11px;[^}]*color:var\(--text-strong\);[^}]*background:var\(--surface-sunken\);/);
    expect(css).toMatch(/\.mc-incident-count\{[^}]*color:var\(--text\);/);
    expect(css).toMatch(/\.mc-breakdown-head h4\{[^}]*color:var\(--text-strong\);/);
  });

  it("aligns every ranked comparison bar to shared columns", () => {
    expect(css).toMatch(/\.mc-ranked\{[^}]*grid-template-columns:22px minmax\(0,1\.6fr\) minmax\(0,2fr\) auto auto;/);
    expect(css).toMatch(/\.mc-ranked-row\{[^}]*grid-template-columns:subgrid;[^}]*grid-column:1 \/ -1;/);
  });
});

// --- contrast ---------------------------------------------------------------
// The tokens are plain hex in this file, so the ratios can be computed rather than eyeballed.

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read a custom property out of a theme block (`.mc-scope{...}` or the dark override). */
function token(name: string, theme: "light" | "dark"): string {
  const block = theme === "light"
    ? css.slice(css.indexOf(".mc-scope{"), css.indexOf("}", css.indexOf(".mc-scope{")))
    : css.slice(css.indexOf('[data-theme="dark"] .mc-scope{'), css.indexOf("}", css.indexOf('[data-theme="dark"] .mc-scope{')));
  const match = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block);
  if (!match) throw new Error(`token --${name} not found in ${theme} theme`);
  return match[1];
}

describe("contrast", () => {
  // Guards the helper itself — black on white is exactly 21:1.
  it("computes a known ratio correctly (self-check)", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });

  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      const surface = () => token("surface", theme);
      const sunken = () => token("surface-sunken", theme);

      // Trend marks are graphical objects: SC 1.4.11 wants 3:1.
      it("draws both trend series at >= 3:1 against the card surface", () => {
        expect(contrast(token("trend-raw", theme), surface())).toBeGreaterThanOrEqual(3);
        expect(contrast(token("trend-rolling", theme), surface())).toBeGreaterThanOrEqual(3);
      });

      // --text-dim labels small text (10-12.5px) on sunken panels: SC 1.4.3 wants 4.5:1.
      it("keeps --text-dim readable on both surfaces at >= 4.5:1", () => {
        expect(contrast(token("text-dim", theme), sunken())).toBeGreaterThanOrEqual(4.5);
        expect(contrast(token("text-dim", theme), surface())).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps --text readable at >= 4.5:1, which .cnt.low now relies on", () => {
        expect(contrast(token("text", theme), surface())).toBeGreaterThanOrEqual(4.5);
        expect(contrast(token("text", theme), sunken())).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  // Product invariant: a trend mark must never imply good/bad.
  it("keeps the trend marks neutral — no red/green semantics", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const name of ["trend-raw", "trend-rolling"]) {
        const hex = token(name, theme);
        const n = parseInt(hex.slice(1), 16);
        const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
        // Red and green must stay level, so the mark can never read as good/bad. Cool
        // blue-grey drift is a palette choice, not a semantic one, so `b` is unconstrained.
        expect(Math.abs(r - g)).toBeLessThanOrEqual(24);
        expect(b).toBeGreaterThanOrEqual(Math.min(r, g) - 8);
      }
    }
  });
});

describe("motion and mobile chrome", () => {
  it("stops the real pin animations under prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\{([^}]*)\}/.exec(css)?.[1] ?? "";
    // .pin .body / .halo were renamed away long ago, so the halo and drop kept animating.
    expect(block).toContain(".mc-pin-halo");
    expect(block).toContain(".mc-pin-icon svg");
    expect(block).not.toContain(".pin .body");
  });

  it("drops the unused fadein keyframes", () => {
    expect(css).not.toContain("@keyframes fadein");
  });

  it("clears the mobile banners of the search pill and respects the side safe areas", () => {
    const mobile = css.slice(css.indexOf("@media (max-width:760px)"));
    // The pill sits at inset-top + 64px and is 44px tall; both banners now stack below it.
    expect(mobile).toMatch(/\.mc-error\{top:calc\(env\(safe-area-inset-top\) \+ 116px\)/);
    expect(mobile).toMatch(/\.mc-banner\{top:calc\(env\(safe-area-inset-top\) \+ 164px\)/);
    expect(mobile).toMatch(/\.mc-topbar\{[^}]*env\(safe-area-inset-right\)[^}]*env\(safe-area-inset-left\)/s);
    expect(mobile).toMatch(/\.mc-workspace-panel\.is-dragging\{transition:none;\}/);
  });

  it("sizes the modal against the dynamic viewport", () => {
    expect(css).toMatch(/\.mc-modal\{[^}]*max-height:90dvh/);
  });
});
