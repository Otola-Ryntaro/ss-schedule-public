import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, ".."),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "side-panel": path.resolve(import.meta.dirname, "side-panel.html"),
        "service-worker": path.resolve(
          import.meta.dirname,
          "src/service-worker.ts",
        ),
        "range-selector": path.resolve(
          import.meta.dirname,
          "src/content/range-selector.ts",
        ),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
