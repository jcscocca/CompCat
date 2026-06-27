// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const clientSrc = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");

// First path segment of every API path the client fetches, e.g. "/routes" from
// fetch("/routes/alternatives") or request(`/places/${id}`).
function usedApiPrefixes(src: string): string[] {
  const prefixes = new Set<string>();
  for (const m of src.matchAll(/(?:request|fetch)\(\s*[`"']\/([a-zA-Z][\w-]*)/g)) {
    prefixes.add(`/${m[1]}`);
  }
  return [...prefixes];
}

// Keys declared in the Vite dev-server proxy map, e.g. "/routes" from `"/routes": backendTarget`.
function proxyKeys(config: string): string[] {
  const keys = new Set<string>();
  for (const m of config.matchAll(/[`"'](\/[a-zA-Z][\w-]*)[`"']\s*:/g)) {
    keys.add(m[1]);
  }
  return [...keys];
}

describe("vite dev-server proxy", () => {
  // The dev server only forwards a request to the backend when its path matches a
  // proxy key; an unmatched API path silently falls through to index.html. This is
  // how the Routes tab broke under `npm run dev` — /routes was never added here.
  it("forwards every API path the client calls", () => {
    const used = usedApiPrefixes(clientSrc);
    const keys = proxyKeys(viteConfig);

    expect(used.length).toBeGreaterThan(0); // guard: the scan actually matched calls
    const missing = used.filter((prefix) => !keys.includes(prefix));
    expect(missing).toEqual([]);
  });
});
