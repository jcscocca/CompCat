import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendTarget = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/testSetup.ts"],
  },
  server: {
    proxy: {
      "/sessions": backendTarget,
      "/places": backendTarget,
      "/dashboard": backendTarget,
      "/exports": backendTarget,
      "/input-modes": backendTarget,
      "/assistant": backendTarget
    }
  },
  build: {
    outDir: "../app/static/dashboard",
    emptyOutDir: true
  }
});
