# AGENTS.md

## Cursor Cloud specific instructions

gojo is a Bun + TypeScript agent-orchestration platform: a CLI + embedded API daemon
(`src/`) plus a Vue admin UI (`web/`) and a static Astro docs site (`site/`). Standard
commands live in `README.md`, `Makefile` (`make help`), and `package.json` — reference
those instead of re-deriving them.

### Runtime / environment

- Bun is the runtime (there is no npm/pnpm lockfile). It is installed at `~/.bun/bin`
  and added to `~/.bashrc`, so interactive shells find `bun` automatically. The startup
  update script (re)installs Bun if missing and runs `bun install` in the repo root,
  `web/`, and `site/`.
- Instance state lives under `~/.gojo` (`GOJO_HOME` to override): SQLite DB, worktrees,
  artifacts, secrets, and `config/instance.yaml`.

### Tests — non-obvious caveat

- `bun test` runs 100+ files concurrently and many spawn real `git` subprocesses. On the
  4-CPU cloud VM the default 5s per-test timeout is too tight, so a *different* random
  subset of the git/workspace/integration tests times out on each run (flaky, not real
  failures). Run the daemon suite with a longer timeout for a reliable green result:
  `bun test --timeout 30000`. Web tests (`bun run --cwd web test`) are fast and reliable.
- `make check` / `scripts/ci-check.sh` is the full gate (daemon typecheck+test, web
  typecheck+test+build, site build, binary compile). Its `bun test` step uses the default
  timeout, so it can show the same flakiness; re-run or use the longer-timeout command
  above to confirm a green daemon suite.

### Running the app

- `bun run dev` (or `make dev`) runs the API daemon on `http://127.0.0.1:7430` (hot
  reload) plus the Vite admin UI on `http://127.0.0.1:5173` (HMR). Use the Vite URL when
  working on the UI — it proxies `/api` to `:7430`. `bun run dev:server` is API-only.
- Create the first admin once with `gojo setup --username <u> --password <p>`
  (via `bun run gojo setup ...` from a checkout). Then log into the web UI with those
  credentials.
- Core end-to-end flow (from `README.md`): register a target repo that contains a
  `gojo.yaml`, `gojo project sync <id>`, then `gojo agent run <agent-id>`. A shell agent
  run should reach state `Succeeded` and, in `commit-only` mode, land its changes on a
  `gojo/<agent>/<project>/<date>/run-<id>` branch without merging to `main`.
