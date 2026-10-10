/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Component tests render real pages in a browser-like DOM (see src/test/renderApp.tsx).
    environment: "jsdom",
    setupFiles: ["@raceoffice/test-utils/setup"],
    // Page tests render the full scoring page with live polling and are CPU-heavy; in parallel
    // they slow each other down until timeouts hit. Sequential runs are predictable.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "http://localhost:8787", ws: true },
      "/sse": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787" },
      "/live-tracking/worker": { target: "http://localhost:8787", changeOrigin: true },
      "/current_race_result": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});

