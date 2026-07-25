#!/usr/bin/env bash
# Run a command with Bun on PATH (default install: ~/.bun/bin).
# gojo validation steps use sh -c and may not inherit a login-shell PATH.
set -euo pipefail

export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH (install from https://bun.sh)" >&2
  exit 1
fi

exec "$@"
