#!/usr/bin/env bash
# Canonical CI gate — keep in sync with `make check` and .github/workflows/ci.yml
# Note: coverage % is not a CI fail criterion (see scripts/daemon-coverage.sh for
# optional maintain-tests gating).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH" >&2
  exit 1
fi

echo "==> typecheck (daemon)"
bun run typecheck

echo "==> test (daemon)"
bun test

if [[ -f "$ROOT/web/package.json" ]]; then
  echo "==> web typecheck + build"
  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    bun install --cwd web
  fi
  bun run --cwd web typecheck
  bun run build:web
fi

if [[ -f "$ROOT/site/package.json" ]]; then
  echo "==> site build"
  if [[ ! -d "$ROOT/site/node_modules" ]]; then
    bun install --cwd site
  fi
  bun run --cwd site build
fi

echo "==> compile gojo binary"
bun run build

echo ""
echo "ci-check: all gates passed"
