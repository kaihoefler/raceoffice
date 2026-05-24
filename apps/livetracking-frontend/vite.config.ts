import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use an absolute app base so module asset URLs stay valid on deep client routes
  // like /livetracking/live-tracking/setup (browser reload/bookmark).
  base: "/livetracking/",

  plugins: [react()],
  build: {

    outDir: "../server/public/livetracking",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/ws": { target: "http://localhost:8787", ws: true },
      "/sse": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787" },
      "/live-tracking": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
