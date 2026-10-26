import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

// In production the build is served by the `app` backend from the same origin.
// In local dev (npm run dev) /api is proxied to the app container.
// `npm run analyze` (mode "analyze") writes the bundle treemap to dist/stats.html (ADR-046).
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    mode === "analyze" &&
      visualizer({ filename: "dist/stats.html", template: "treemap", gzipSize: true, projectRoot: process.cwd().replaceAll("\\", "/") }),
  ],
  // the lazily loaded map and shadow chunks (MapLibre GL / Three.js, R3F) are large; the main bundle stays small
  build: { chunkSizeWarningLimit: 1800 },
  // MapLibre's worker is an ES module
  worker: { format: "es" },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
}));
