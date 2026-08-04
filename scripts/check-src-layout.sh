#!/usr/bin/env bash
# Assert src/ contains exactly the five layered-monolith directories.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src"

ALLOWED=$'contexts\ninfrastructure\nkernel\nplatform\ntransports'
ACTUAL="$(find "$SRC" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)"

if [[ "$ACTUAL" != "$ALLOWED" ]]; then
  echo "error: src/ layout drift — expected exactly:" >&2
  echo "$ALLOWED" | sed 's/^/  /' >&2
  echo "found:" >&2
  echo "$ACTUAL" | sed 's/^/  /' >&2
  echo "See src/README.md for where new files belong." >&2
  exit 1
fi

# No loose .ts files at src/ root
LOOSE="$(find "$SRC" -maxdepth 1 -type f -name '*.ts' -printf '%f\n' || true)"
if [[ -n "$LOOSE" ]]; then
  echo "error: loose TypeScript files under src/ (move into a layer):" >&2
  echo "$LOOSE" | sed 's/^/  /' >&2
  exit 1
fi

echo "src/ layout ok (kernel, contexts, platform, transports, infrastructure)"
