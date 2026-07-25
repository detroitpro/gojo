#!/usr/bin/env bash
# Preflight health checks against the live gojo instance (systemd home by default).
set -euo pipefail

GOJO_BIN="${GOJO_BIN:-}"
if [[ -z "${GOJO_BIN}" ]]; then
  if command -v gojo >/dev/null 2>&1; then
    GOJO_BIN="$(command -v gojo)"
  elif [[ -x "${HOME}/.local/bin/gojo" ]]; then
    GOJO_BIN="${HOME}/.local/bin/gojo"
  else
    echo "gojo CLI not found; run make install-cli first" >&2
    exit 1
  fi
fi

HOME_FLAG=()
if [[ -n "${GOJO_HOME:-}" ]]; then
  HOME_FLAG=(--home "${GOJO_HOME}")
fi

echo "==> Instance doctor (${GOJO_BIN})"
"${GOJO_BIN}" "${HOME_FLAG[@]}" server doctor

echo
echo "==> Project doctors"
mapfile -t PROJECT_IDS < <(
  "${GOJO_BIN}" "${HOME_FLAG[@]}" --output json project list \
    | bun -e '
      const chunks = [];
      for await (const c of Bun.stdin.stream()) chunks.push(c);
      const text = Buffer.concat(chunks).toString("utf8");
      const data = JSON.parse(text);
      const projects = data.projects ?? data.data?.projects ?? [];
      for (const p of projects) {
        if (p?.id) console.log(p.id);
      }
    '
)

if [[ ${#PROJECT_IDS[@]} -eq 0 ]]; then
  echo "(no projects)"
  exit 0
fi

fail=0
for id in "${PROJECT_IDS[@]}"; do
  echo
  echo "--- project ${id} ---"
  if ! "${GOJO_BIN}" "${HOME_FLAG[@]}" project doctor "${id}"; then
    fail=1
  fi
done

exit "${fail}"
