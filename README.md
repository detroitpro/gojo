# gojo

Self-hosted platform for scheduling, executing, and auditing autonomous software-development agents against Git repositories.

gojo prepares isolated workspaces, invokes agent adapters (Cursor, Claude Code, shell, and others), validates results, integrates approved work, and exposes a CLI plus embedded web UI for operations.

See [PRD.md](./PRD.md) for the full product specification.

## Quickstart

Requires [Bun](https://bun.sh) 1.2+.

```bash
git clone <repo-url> gojo
cd gojo
bun install
bun run gojo setup --username admin --password 'your-password'
bun run gojo server start
```

Open the URL printed by `server start` (default `http://127.0.0.1:7430`).

## Common commands

```bash
# First-time admin setup
gojo setup --username admin --password 'secret'

# Run the API + scheduler + web UI
gojo server start

# Register a Git repository, then sync gojo.yaml from the repo
gojo project add demo /path/to/repo --branch main
gojo project sync <project-id>

# Run a task manually
gojo task run <task-id>

# Inspect runs and schedules
gojo run list
gojo schedule list
```

Use `gojo --help` for the full command tree.

## Public site

Consumer-facing docs and landing page live in [`site/`](./site/) (Astro, static output). Not served by the gojo daemon.

```bash
cd site
bun install
bun run dev      # http://localhost:4321
bun run build    # → site/dist
```

## Build

```bash
bun run build          # compile bin/gojo for the current platform
bun run build:web      # build web UI when web/ exists
bun run check          # typecheck + tests
```

The build script compiles `src/cli/index.ts` to `bin/gojo` and, when `web/dist` exists, copies it to `bin/web/dist` beside the binary.

Set `GOJO_WEB_DIST` to override where the server loads static assets from.

## npx bootstrap (MVP)

`packages/npx-bootstrap` provides a small Node launcher for distribution experiments:

1. `GOJO_BIN` if set
2. `gojo` on `PATH` (unless it is the bootstrap script itself)
3. `bun` + repo `src/cli/index.ts` when developing from source
4. Otherwise prints install instructions

## Architecture

- **Runtime:** Bun + TypeScript (CLI, API server, scheduler, adapters)
- **Persistence:** SQLite via `bun:sqlite`
- **Web UI:** Vue app in `web/` (embedded static assets)
- **Distribution:** `bun build --compile` native binaries; optional npm bootstrap package

Data lives under `~/.gojo` by default (`GOJO_HOME` to override).
