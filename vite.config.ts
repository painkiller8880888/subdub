import * as path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const apiProxy = {
  target: "http://127.0.0.1:3000"
};

export default defineConfig({
  root: path.resolve(projectRoot, "src/web"),
  publicDir: path.resolve(projectRoot, "public"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiProxy
    }
  },
  build: {
    outDir: path.resolve(projectRoot, "dist/web"),
    emptyOutDir: true
  },
  test: {
    root: projectRoot,
    include: ["tests/**/*.test.ts"]
  }
});
