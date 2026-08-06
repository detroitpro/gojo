#!/usr/bin/env bash
# Canonical CI gate — keep in sync with `make check` and .github/workflows/ci.yml
# Daemon tests use a 30s per-test timeout so git/workspace suites stay reliable.
# Line coverage is ratchet-gated via coverage-baseline.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH" >&2
  exit 1
fi

# Never skip git/workspace suites in the CI gate (cloud agent env otherwise
# sets CURSOR_AGENT=1 and describeUnlessCloud would hide Execution surface).
export GOJO_RUN_CLOUD_INCOMPATIBLE_TESTS=1

echo "==> typecheck (daemon)"
bun run typecheck

echo "==> gojo.yaml JSON Schema drift"
bun run "$ROOT/scripts/generate-manifest-json-schema.ts" --check

echo "==> src/ layout"
bash "$ROOT/scripts/check-src-layout.sh"

echo "==> dependency boundaries"
bunx depcruise --config .dependency-cruiser.cjs --output-type err src packages/contracts/src web/src

echo "==> test + coverage ratchet (daemon, timeout 30s)"
COV_REPORT="$(mktemp)"
set +e
bun test --timeout 30000 --coverage --coverage-reporter=text >"$COV_REPORT" 2>&1
TEST_STATUS=$?
set -e
cat "$COV_REPORT"
if [[ "$TEST_STATUS" -ne 0 ]]; then
  rm -f "$COV_REPORT"
  exit "$TEST_STATUS"
fi
bash "$ROOT/scripts/check-coverage-baseline.sh" "$COV_REPORT"
rm -f "$COV_REPORT"

if [[ -f "$ROOT/web/package.json" ]]; then
  echo "==> web layout"
  bash "$ROOT/scripts/check-web-layout.sh"

  echo "==> web typecheck + build"
  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    bun install --cwd web
  fi
  bun run --cwd web typecheck
  bun run --cwd web test
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
