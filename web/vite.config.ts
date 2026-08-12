import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ["@atlaskit/tokens/babel-plugin", { shouldUseAutoFallback: true }],
          "@compiled/babel-plugin",
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  ],
  test: {
    environment: "happy-dom",
    include: ["tests/*.vitest.ts", "tests/*.vitest.tsx"],
    setupFiles: ["tests/setup.ts"],
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
      "@shared": fileURLToPath(new URL("../packages/contracts/src", import.meta.url)),
      "@gojo/contracts/types": fileURLToPath(
        new URL("../packages/contracts/types.ts", import.meta.url),
      ),
      "@gojo/contracts": fileURLToPath(new URL("../packages/contracts/src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        // Match gojo DEFAULT_BIND_PORT (src/config/instance.ts).
        target: "http://127.0.0.1:7430",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
