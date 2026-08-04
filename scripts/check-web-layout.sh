#!/usr/bin/env bash
# Assert web/src contains exactly the five layout directories.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/web/src"

ALLOWED=$'contexts\ninfrastructure\nkernel\nplatform\nui'
ACTUAL="$(find "$SRC" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)"

if [[ "$ACTUAL" != "$ALLOWED" ]]; then
  echo "error: web/src layout drift — expected exactly:" >&2
  echo "$ALLOWED" | sed 's/^/  /' >&2
  echo "found:" >&2
  echo "$ACTUAL" | sed 's/^/  /' >&2
  echo "See web/src/README.md for where new files belong." >&2
  exit 1
fi

# Only env.d.ts and README.md at web/src root
LOOSE="$(find "$SRC" -maxdepth 1 -type f ! -name 'env.d.ts' ! -name 'README.md' -printf '%f\n' || true)"
if [[ -n "$LOOSE" ]]; then
  echo "error: loose files under web/src (move into a layer; only env.d.ts and README.md allowed at root):" >&2
  echo "$LOOSE" | sed 's/^/  /' >&2
  exit 1
fi

echo "web/src layout ok (contexts, infrastructure, kernel, platform, ui)"
