# gojo public site

Static marketing and documentation site for gojo (Astro). Separate from the ops UI in `web/`.

## Commands

```bash
cd site
bun install
bun run dev      # local preview
bun run build    # write site/dist
bun run preview  # serve the build
```

Pages: landing, Getting started, First agent, plus Documentation (Advanced agent, Advanced usage, Settings, Concepts, CLI, FAQ).

## Regenerate UI screenshots

Committed PNGs under `public/images/ui-*.png` are captured from a live ops console (not CI).

1. Start gojo with representative data. For the packaged UI on `:7430`, rebuild and install so `~/.gojo/web/dist` matches the checkout (`make build && bun run install:cli && gojo service restart`). Or use Vite: `make dev` and set `GOJO_BASE_URL`.
2. Install Playwright Chromium once: `bunx playwright install chromium`
3. From the repo root:

```bash
bun run screenshots:ui
# or: make screenshots-ui
# Vite HMR UI: GOJO_BASE_URL=http://127.0.0.1:5173 bun run screenshots:ui
```

4. Spot-check the five files, tweak docs captions if the UI changed, then commit.

Auth: the capture script mints a `gojo_session` cookie from `$GOJO_HOME` (default `~/.gojo`). Override with `GOJO_SESSION` or `GOJO_USER`.
