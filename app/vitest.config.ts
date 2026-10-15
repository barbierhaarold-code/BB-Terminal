import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // The macro disk cache is off in tests unless a test passes its own MACRO_CACHE_DIR (a temp dir).
  test: { include: ["src/**/*.test.ts"], environment: "node", env: { MACRO_CACHE_DIR: "off" } },
});
