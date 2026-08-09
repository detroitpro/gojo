#!/usr/bin/env bash
# Daemon unit/integration tests (pass/fail gate for daemon-unit validation profile).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  bun install
fi

if [[ -f "$ROOT/web/package.json" && ! -d "$ROOT/web/node_modules" ]]; then
  bun install --cwd web
fi

echo "==> test (daemon)"
bash scripts/with-bun.sh bun test "$@"
