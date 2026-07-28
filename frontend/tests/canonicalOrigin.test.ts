// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { absolutizeSocialMeta, canonicalOriginMeta } from "../vite.config";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");

function metaContent(source: string, attr: "name" | "property", value: string): string[] {
  const pattern = new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*>`, "gi");
  return (source.match(pattern) ?? []).map(
    (tag) => /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "",
  );
}

afterEach(() => {
  delete process.env.VITE_CANONICAL_ORIGIN;
});

describe("absolutizeSocialMeta", () => {
  it("leaves the html untouched with no canonical origin", () => {
    expect(absolutizeSocialMeta(html, undefined)).toBe(html);
    expect(absolutizeSocialMeta(html, "")).toBe(html);
  });

  it("absolutizes the og and twitter images against the origin", () => {
    const out = absolutizeSocialMeta(html, "https://compcat.app");
    expect(metaContent(out, "property", "og:image")).toEqual([
      "https://compcat.app/assets/og-card.png",
    ]);
    expect(metaContent(out, "name", "twitter:image")).toEqual([
      "https://compcat.app/assets/og-card.png",
    ]);
  });

  it("adds an og:url the source html does not carry", () => {
    expect(metaContent(html, "property", "og:url")).toEqual([]);
    const out = absolutizeSocialMeta(html, "https://compcat.app");
    expect(metaContent(out, "property", "og:url")).toEqual(["https://compcat.app/"]);
  });

  it("tolerates a trailing slash on the origin", () => {
    const out = absolutizeSocialMeta(html, "https://compcat.app/");
    expect(metaContent(out, "property", "og:image")).toEqual([
      "https://compcat.app/assets/og-card.png",
    ]);
    expect(metaContent(out, "property", "og:url")).toEqual(["https://compcat.app/"]);
  });

  it("touches nothing but the social tags", () => {
    const out = absolutizeSocialMeta(html, "https://compcat.app");
    // Icons, manifest and the module script stay relative — they are same-origin fetches.
    expect(out).toMatch(/rel=["']icon["'][^>]*href=["']\/assets\/favicon\.svg["']/);
    expect(out).toMatch(/rel=["']manifest["'][^>]*href=["']\/assets\/site\.webmanifest["']/);
    expect(metaContent(out, "property", "og:image:width")).toEqual(["1440"]);
    expect(metaContent(out, "name", "description")).toEqual(
      metaContent(html, "name", "description"),
    );
  });
});

describe("canonicalOriginMeta plugin", () => {
  const transform = canonicalOriginMeta().transformIndexHtml as (input: string) => string;

  it("rewrites when VITE_CANONICAL_ORIGIN is set at build time", () => {
    process.env.VITE_CANONICAL_ORIGIN = "https://compcat.app";
    expect(transform(html)).toContain("https://compcat.app/assets/og-card.png");
  });

  it("is inert when the variable is unset (the repo default)", () => {
    delete process.env.VITE_CANONICAL_ORIGIN;
    expect(transform(html)).toBe(html);
  });
});
