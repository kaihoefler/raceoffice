/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

/**
 * Version shown in the UI. Release builds (release.yml, tag push) pass the tag via RELEASE_TAG;
 * the shallow CI checkout has no tags, so git describe would only yield a commit hash there.
 * Local builds fall back to git describe, e.g. "v1.0.5-1-g605e0b4-dirty".
 */
function resolveAppVersion(): string {
  if (process.env.RELEASE_TAG) return process.env.RELEASE_TAG;
  try {
    return execSync("git describe --tags --always --dirty", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
    // Listen on all interfaces so the dev server is reachable from other machines in the LAN.
    host: true,
    proxy: {
      "/ws": { target: "http://localhost:8787", ws: true },
      "/sse": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787" },
      "/current_race_result": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});

