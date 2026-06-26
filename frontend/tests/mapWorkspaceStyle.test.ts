// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/mapWorkspace.css", import.meta.url), "utf8");

describe("map workspace styles", () => {
  it("keeps incident table data readable against the dark workspace panel", () => {
    expect(css).toMatch(/\.mc-incident-table\{[^}]*font-size:13px;[^}]*color:var\(--text\);/);
    expect(css).toMatch(/\.mc-incident-table th,\.mc-incident-table td\{[^}]*color:var\(--text\);/);
    expect(css).toMatch(/\.mc-incident-table th\{[^}]*font-size:11px;[^}]*color:#fff;/);
    expect(css).toMatch(/\.mc-incident-count\{[^}]*color:var\(--text\);/);
    expect(css).toMatch(/\.mc-breakdown-head h5\{[^}]*color:var\(--text\);/);
  });
});
