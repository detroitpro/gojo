import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

import { rehypeBaseLinks } from "./src/lib/rehype-base-links.ts";

/** GitHub Pages project site: https://detroitpro.github.io/gojo/ */
const siteBase = "/gojo";

export default defineConfig({
  output: "static",
  site: "https://detroitpro.github.io",
  base: siteBase,
  trailingSlash: "never",
  markdown: {
    rehypePlugins: [rehypeBaseLinks(siteBase)],
  },
  vite: {
    resolve: {
      alias: {
        "@theme": fileURLToPath(new URL("../theme", import.meta.url)),
      },
    },
  },
});
