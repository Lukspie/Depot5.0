import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In production the build is served by the `app` backend from the same origin.
// In local dev (npm run dev) /api is proxied to the app container.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the lazily loaded map chunk (MapLibre GL + Three.js) is ~1.6 MB; the main bundle stays small
  build: { chunkSizeWarningLimit: 1800 },
  // MapLibre's worker is an ES module
  worker: { format: "es" },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
