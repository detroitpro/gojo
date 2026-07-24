#!/usr/bin/env bash
# Canonical quality gate — keep in sync with `make check` and .github/workflows/ci.yml
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE_FILE="${COVERAGE_BASELINE_FILE:-$ROOT/coverage-baseline.json}"
export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH" >&2
  exit 1
fi

echo "==> typecheck (daemon)"
bun run typecheck

echo "==> test + coverage (daemon)"
COVERAGE_OUT="$(mktemp)"
trap 'rm -f "$COVERAGE_OUT"' EXIT
set -o pipefail
bun test --coverage --coverage-reporter=text 2>&1 | tee "$COVERAGE_OUT"
set +o pipefail

LINE_PCT="$(
  awk -F'|' '
    /^All files/ {
      gsub(/[[:space:]]/, "", $3);
      print $3;
      exit
    }
  ' "$COVERAGE_OUT"
)"
LINE_PCT="${LINE_PCT%%%}"

if [[ -z "$LINE_PCT" ]]; then
  echo "error: could not parse All files line coverage from bun test --coverage" >&2
  exit 1
fi

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "error: missing coverage baseline: $BASELINE_FILE" >&2
  exit 1
fi

MIN_LINE="$(
  bun -e "const b=await Bun.file(process.argv[1]).json(); process.stdout.write(String(b.minLineCoverage))" \
    "$BASELINE_FILE"
)"
echo "Coverage lines: ${LINE_PCT}% (baseline min: ${MIN_LINE}%)"

bun -e "
const actual = Number(process.argv[1]);
const min = Number(process.argv[2]);
if (Number.isNaN(actual) || Number.isNaN(min)) {
  console.error('error: invalid coverage numbers', { actual, min });
  process.exit(1);
}
if (actual + 1e-9 < min) {
  console.error('error: line coverage ' + actual + '% is below baseline ' + min + '%');
  process.exit(1);
}
console.log('Coverage baseline OK');
" "$LINE_PCT" "$MIN_LINE"

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
