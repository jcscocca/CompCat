// @vitest-environment node
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

  it("opts into the safe-area viewport (viewport-fit=cover) for iOS insets", () => {
    const viewport = /<meta[^>]*name=["']viewport["'][^>]*>/i.exec(html)?.[0] ?? "";
    expect(viewport).toMatch(/viewport-fit=cover/);
  });
});
