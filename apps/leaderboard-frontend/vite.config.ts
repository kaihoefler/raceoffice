/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Leaderboard frontend (doc/leaderboard-integration/06-frontend.md).
// - Built into the leaderboard service (`public/`), which serves it under /ui/ –
//   behind the RaceOffice proxy that is /leaderboard/ui/. Relative base + HashRouter keep it
//   working under both prefixes without server rewrites.
// - Dev: port 5176, API/WS proxied to a locally running service on :8080.
const SERVICE = process.env.LEADERBOARD_SERVICE_URL ?? "http://localhost:8080";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["@raceoffice/test-utils/setup"],
    testTimeout: 15_000,
  },
  build: {
    outDir: "../leaderboard-service/public",
    emptyOutDir: true,
  },
  server: {
    port: 5176,
    host: true,
    proxy: {
      "/api": { target: SERVICE },
      "/ws": { target: SERVICE, ws: true },
      "/race": { target: SERVICE },
      "/health": { target: SERVICE },
    },
  },
});
