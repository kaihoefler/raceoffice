import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../server/public/p3test",
    emptyOutDir: true,
  },
  server: {
    port: 5175,
    // Listen on all interfaces so the dev server is reachable from other machines in the LAN.
    host: true,
    proxy: {
      "/p3-test": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
