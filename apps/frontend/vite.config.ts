import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/ws": { target: "http://localhost:8787", ws: true },
      "/sse": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787" },
    },
  },
})
