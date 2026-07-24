import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: "https://gojo.dev",
  trailingSlash: "never",
  vite: {
    resolve: {
      alias: {
        "@theme": fileURLToPath(new URL("../theme", import.meta.url)),
      },
    },
  },
});
