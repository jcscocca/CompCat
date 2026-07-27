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

export default defineConfig({
  plugins: [react(), maplibreWorkerAssets()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  test: {
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
        manualChunks: {
          markdown: ["react-markdown"],
          maplibre: ["maplibre-gl", "pmtiles", "@protomaps/basemaps"]
        }
      }
    }
  }
});
