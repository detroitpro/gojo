#!/usr/bin/env bash
# Daemon tests with a coverage report (informational when run alone).
# The CI gate (`scripts/ci-check.sh`) also runs coverage and fails if line
# coverage drops below coverage-baseline.json — see check-coverage-baseline.sh.
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

echo "==> test + coverage report (daemon; informational, not a fail gate)"
bun test --coverage --coverage-reporter=text
