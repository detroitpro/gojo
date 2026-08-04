#!/usr/bin/env bash
# Compare a bun --coverage text report (stdin or file) against coverage-baseline.json.
# Usage:
#   bun test --coverage --coverage-reporter=text | tee /tmp/cov.txt
#   bash scripts/check-coverage-baseline.sh /tmp/cov.txt
# Or:
#   bun test --coverage --coverage-reporter=text 2>&1 | bash scripts/check-coverage-baseline.sh -
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE_FILE="$ROOT/coverage-baseline.json"
if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "error: missing $BASELINE_FILE" >&2
  exit 1
fi

MIN="$(bun -e "const b=require('./coverage-baseline.json'); process.stdout.write(String(b.minLineCoverage))")"
if [[ -z "$MIN" ]]; then
  echo "error: coverage-baseline.json missing minLineCoverage" >&2
  exit 1
fi

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  echo "error: pass a coverage report file path, or '-' for stdin" >&2
  exit 1
fi

if [[ "$INPUT" == "-" ]]; then
  REPORT="$(cat)"
else
  REPORT="$(cat "$INPUT")"
fi

# Bun text reporter: "All files | % Funcs | % Lines |" — values may omit a trailing %.
LINE_PCT="$(printf '%s\n' "$REPORT" | awk '
  /All files/ {
    n = 0;
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^[0-9]+(\.[0-9]+)?%?$/) {
        val = $i;
        gsub(/%/, "", val);
        nums[++n] = val;
      }
    }
    if (n >= 2) last = nums[n];
    else if (n == 1) last = nums[1];
  }
  END { if (last != "") print last }
')"

if [[ -z "${LINE_PCT:-}" ]]; then
  echo "error: could not parse All files line coverage from report" >&2
  exit 1
fi

echo "measured line coverage: ${LINE_PCT}% (baseline ${MIN}%)"
awk -v measured="$LINE_PCT" -v min="$MIN" 'BEGIN {
  if (measured + 0 < min + 0) {
    printf "error: line coverage %.2f%% is below baseline %.2f%%\n", measured, min > "/dev/stderr"
    exit 1
  }
  printf "coverage ratchet ok: %.2f%% >= %.2f%%\n", measured, min
}'
