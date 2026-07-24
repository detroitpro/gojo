#!/usr/bin/env bash
# Daemon tests with a coverage *report* (no baseline fail gate).
# Use make coverage / this script for visibility; CI and gojo validation
# must not fail solely because coverage % moved.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH" >&2
  exit 1
fi

echo "==> test + coverage report (daemon; informational, not a fail gate)"
bun test --coverage --coverage-reporter=text
