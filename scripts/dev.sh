#!/usr/bin/env bash
# Hot-reload gojo API (bun --watch) + Vite admin UI (HMR).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_HOST="${GOJO_DEV_WEB_HOST:-127.0.0.1}"
WEB_PORT="${GOJO_DEV_WEB_PORT:-5173}"

PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install from https://bun.sh" >&2
  exit 1
fi

echo "gojo dev (hot reload)"
echo "  API  http://127.0.0.1:7430  (bun --watch; serves built web/dist too)"
echo "  UI   http://${WEB_HOST}:${WEB_PORT}  (Vite HMR — use this while editing the admin UI)"
echo

bun --watch src/cli/index.ts server start &
PIDS+=($!)

(
  cd "$ROOT/web"
  exec bun run dev -- --host "$WEB_HOST" --port "$WEB_PORT"
) &
PIDS+=($!)

# Wait until either child exits (portable; no bash wait -n).
status=0
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || status=$?
      exit "$status"
    fi
  done
  sleep 0.5
done
