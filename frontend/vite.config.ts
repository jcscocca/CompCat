import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.VITE_BACKEND_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/testSetup.ts"],
  },
  server: {
    proxy: {
      "/sessions": backendTarget,
      "/places": backendTarget,
      "/uploads": backendTarget,
      "/dashboard": backendTarget,
      "/routes": backendTarget,
      "/exports": backendTarget,
      "/input-modes": backendTarget,
      "/assistant": backendTarget
    }
  },
  build: {
    outDir: "../app/static/dashboard",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split the markdown renderer (react-markdown + micromark/* deps) into its own
        // chunk so it doesn't bloat the main bundle past the size-warning threshold.
        manualChunks: { markdown: ["react-markdown"] }
      }
    }
  }
});
