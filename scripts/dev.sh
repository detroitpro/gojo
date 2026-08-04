#!/usr/bin/env bash
# Hot-reload gojo API (bun --watch) + Vite admin UI (HMR).
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_HOST="${GOJO_DEV_WEB_HOST:-127.0.0.1}"
WEB_PORT="${GOJO_DEV_WEB_PORT:-5173}"

PIDS=()
CLEANING=0

kill_tree() {
  local signal="$1"
  local pid
  for pid in "${PIDS[@]:-}"; do
    # With job control, backgrounded children are process-group leaders (PGID=PID).
    kill "-${signal}" -- "-${pid}" 2>/dev/null || kill "-${signal}" "${pid}" 2>/dev/null || true
  done
}

any_alive() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

cleanup() {
  if [[ "${CLEANING}" -eq 1 ]]; then
    return
  fi
  CLEANING=1

  kill_tree TERM

  local i
  for i in $(seq 1 30); do
    if ! any_alive; then
      break
    fi
    sleep 0.1
  done

  if any_alive; then
    kill_tree KILL
    sleep 0.1
  fi

  wait 2>/dev/null || true
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install from https://bun.sh" >&2
  exit 1
fi

echo "gojo dev (hot reload)"
echo "  API  http://127.0.0.1:7430  (bun --watch; serves built web/dist too)"
echo "  UI   http://${WEB_HOST}:${WEB_PORT}  (Vite HMR — use this while editing the admin UI)"
echo

bun --watch src/transports/cli/index.ts server start &
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
