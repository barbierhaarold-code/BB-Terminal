import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { proxyPlugins } from "./vite-plugins/registry";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  return {
    plugins: [
      react(),
      // Auth gate first, then every proxy (single list shared with the production server).
      ...proxyPlugins(env),
    ],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
      port: 5173,
      strictPort: false,
    },
  };
});
