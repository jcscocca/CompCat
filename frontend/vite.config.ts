import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  // @ts-expect-error — vitest injects "test" into vite config; types live in vitest/config
  test: {
    setupFiles: ["./src/testSetup.ts"],
  },
  server: {
    proxy: {
      "/sessions": backendTarget,
      "/places": backendTarget,
      "/dashboard": backendTarget,
      "/exports": backendTarget,
      "/input-modes": backendTarget
    }
  },
  build: {
    outDir: "../app/static/dashboard",
    emptyOutDir: true
  }
});
