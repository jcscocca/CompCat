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
