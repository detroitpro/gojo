import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["tests/*.vitest.ts"],
  },
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
        // Keep SSE (/runs/:id/events) unbuffered for live activity.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.url?.includes("/events")) {
              proxyReq.setHeader("Accept", "text/event-stream");
            }
          });
          proxy.on("proxyRes", (proxyRes, req) => {
            if (req.url?.includes("/events")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
    },
  },
});
