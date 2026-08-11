import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.VITE_BACKEND_TARGET ?? "http://127.0.0.1:8000";

// maplibre-gl v6 (ESM-only) spawns its worker from a sibling file of the module
// URL, which the bundled chunk can't provide. Emit the worker + its shared module
// at a stable path; MapCanvas points setWorkerUrl at it in production builds.
// (In dev, optimizeDeps.exclude keeps maplibre unbundled so the sibling resolves.)
function maplibreWorkerAssets(): Plugin {
  return {
    name: "maplibre-worker-assets",
    apply: "build",
    generateBundle() {
      for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        this.emitFile({
          type: "asset",
          fileName: `assets/maplibre/${file}`,
          source: readFileSync(resolve(__dirname, "node_modules/maplibre-gl/dist", file)),
        });
      }
    },
  };
}

// Link unfurlers (Slack, iMessage, Twitter/X, Discord) resolve og:image against the page URL
// unreliably or not at all, so a shared link renders without its card unless these are
// absolute. Absolutize at build time from VITE_CANONICAL_ORIGIN rather than hardcoding the
// domain: unset (the repo default, and every dev/CI build) keeps index.html's relative form,
// which is what the same-origin app actually wants.
export function absolutizeSocialMeta(html: string, origin: string | undefined): string {
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  if (!base) return html;
  const absolute = html.replace(
    /(<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["'])(\/[^"']*)/gi,
    (_match, head: string, path: string) => `${head}${base}${path}`,
  );
  // og:url has no relative form worth shipping, so it exists only in an absolutized build.
  return absolute.replace(
    /(<meta[^>]*property=["']og:type["'][^>]*>)/i,
    `$1\n    <meta property="og:url" content="${base}/" />`,
  );
}

export function canonicalOriginMeta(): Plugin {
  return {
    name: "canonical-origin-meta",
    apply: "build",
    // Read the env at call time, not module scope, so the build that sets it is the build
    // that gets it (and the test can exercise both branches).
    transformIndexHtml: (html: string) =>
      absolutizeSocialMeta(html, process.env.VITE_CANONICAL_ORIGIN),
  };
}

export default defineConfig({
  plugins: [react(), maplibreWorkerAssets(), canonicalOriginMeta()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  test: {
    // Playwright owns tests/visual/*.spec.ts. Keeping Vitest on *.test.* prevents
    // the two runners from collecting each other's suites during `make test-all`.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    setupFiles: ["./src/testSetup.ts"],
  },
  server: {
    proxy: {
      "/sessions": backendTarget,
      "/places": backendTarget,
      "/uploads": backendTarget,
      "/dashboard": backendTarget,
      "/exports": backendTarget,
      "/input-modes": backendTarget,
      "/assistant": backendTarget,
      "/tiles": backendTarget
    }
  },
  build: {
    outDir: "../app/static/dashboard",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing vendor stacks into their own chunks so they
        // cache independently of app code (an app-only change no longer re-downloads
        // ~1MB of map/markdown vendor) and the main bundle stays under the size warning.
        manualChunks(id) {
          if (id.includes("/node_modules/react-markdown/")) {
            return "markdown";
          }
          if (
            id.includes("/node_modules/maplibre-gl/") ||
            id.includes("/node_modules/pmtiles/") ||
            id.includes("/node_modules/@protomaps/basemaps/")
          ) {
            return "maplibre";
          }
        }
      }
    }
  }
});
