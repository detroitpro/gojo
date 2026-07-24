import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@theme": fileURLToPath(new URL("../theme", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        // Match gojo DEFAULT_BIND_PORT (src/config/instance.ts).
        target: "http://127.0.0.1:7430",
        changeOrigin: true,
      },
    },
  },
});
