/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use an absolute app base so module asset URLs stay valid on deep client routes
  // like /livetracking/live-tracking/setup (browser reload/bookmark).
  base: "/livetracking/",

  plugins: [react()],
  test: {
    // Component tests render real pages in a browser-like DOM (see src/test/renderApp.tsx).
    environment: "jsdom",
    setupFiles: ["@raceoffice/test-utils/setup"],
    // Setup editor tests type into the full control page, which re-renders on every keystroke;
    // under load (cold cache, CI) that exceeds the 5 s default.
    testTimeout: 15_000,
  },
  build: {

    outDir: "../server/public/livetracking",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    // Listen on all interfaces so the dev server is reachable from other machines in the LAN.
    host: true,
    proxy: {
      "/ws": { target: "http://localhost:8787", ws: true },
      "/sse": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787" },
      "/live-tracking": { target: "http://localhost:8787", changeOrigin: true },
      // Timing layer API (passing store: stats, query, delete).
      "/timing": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
