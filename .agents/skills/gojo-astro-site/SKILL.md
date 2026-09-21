---
name: gojo-astro-site
description: >-
  Pedantic Astro 5 best practices for the gojo docs/marketing site under site/.
  Use when editing site/, Astro pages, Markdown docs content, site styles, or
  GitHub Pages base-path behavior.
---

# gojo Astro site (pedantic)

## Non-negotiables

1. **Base-aware URLs** — Site is deployed at `/gojo` on GitHub Pages. Use `href()` / `stripBase()` from `site/src/lib/paths.ts`. Never hardcode root-absolute nav links that ignore `base`.
2. **Markdown links** — Root-absolute Markdown links are rewritten via `rehypeBaseLinks` in `site/astro.config.mjs`. Keep that working; don’t bypass with broken absolute paths.
3. **Static output** — `output: "static"`. No ad-hoc SSR unless the project explicitly adopts an adapter.
4. **Theme tokens** — Prefer shared `@theme` / CSS variables; don’t invent one-off purple/cream AI palettes on marketing surfaces.
5. **Accessibility** — Real headings, `aria-current` on nav, keyboard-usable controls, contrast.
6. **Verify** — `bun run --cwd site build` (also part of `make check`).

## Practices

- Prefer Content Collections / typed frontmatter when adding structured docs content.
- Keep page scripts minimal (vanilla) unless there is a clear need for a framework island.
- One job per section on landing pages; don’t dump dashboard chrome into the hero.
- User-facing docs live in `site/`; maintainer/architecture docs live in repo `docs/` — don’t mix them.

## Config anchors

- `site/astro.config.mjs` — `site`, `base`, markdown rehype
- `site/src/lib/paths.ts` — link helpers
- Theme: `theme/` via Vite alias `@theme`
