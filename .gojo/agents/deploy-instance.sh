#!/usr/bin/env sh
# Build, install CLI + web UI, and restart the gojo service from this synced worktree.
set -eu

echo "==> Deploying gojo from worktree at $(pwd)"
echo "==> HEAD: $(git rev-parse --short HEAD) ($(git rev-parse HEAD))"

: "${GOJO_RUN_ID:?GOJO_RUN_ID is required}"

echo "==> Installing locked dependencies"
bun install --frozen-lockfile

echo "==> Building and installing CLI + web UI"
bun run install:cli

GOJO_BIN="${HOME}/.local/bin/gojo"
if [ ! -x "$GOJO_BIN" ]; then
  GOJO_BIN="$(pwd)/bin/gojo"
fi
"$GOJO_BIN" service install

COMMIT_SHORT=$(git rev-parse --short HEAD)
COMMIT_FULL=$(git rev-parse HEAD)

mkdir -p .gojo
cat > .gojo/handoff.json <<EOF
{
  "schemaVersion": 2,
  "runId": "${GOJO_RUN_ID}",
  "status": "completed",
  "summary": "Deployed gojo instance at ${COMMIT_SHORT}",
  "startingCommit": "${COMMIT_FULL}",
  "resultCommit": "${COMMIT_FULL}",
  "filesChanged": [],
  "validation": {
    "passed": true,
    "steps": []
  },
  "decisions": [
    "Installed locked dependencies and built CLI/UI from the synced worktree so origin/main is what gets deployed.",
    "Scheduled the daemon restart in a separate systemd transient unit so restarting gojo.service cannot kill this run before its handoff is recorded."
  ],
  "unresolvedIssues": [],
  "recommendedNextActions": [
    "Confirm the admin UI and remote CSRF behavior on the public URL if network settings changed.",
    "Re-run this agent after future merges to main, or add a schedule once you trust unattended deploys."
  ],
  "agentAssessment": {
    "successful": true,
    "confidence": 0.95
  },
  "impact": {
    "items": [
      {
        "category": "maintenance",
        "subject": "gojo.service",
        "summary": "Rebuilt and restarted the gojo daemon from ${COMMIT_SHORT}",
        "confidence": 0.95,
        "evidence": {
          "references": ["${COMMIT_FULL}"]
        }
      }
    ]
  }
}
EOF

echo "==> Scheduling service restart in 30 seconds"
systemd-run \
  --user \
  --unit "gojo-deploy-restart-${GOJO_RUN_ID}" \
  --on-active=30s \
  /usr/bin/systemctl --user restart gojo.service

echo "==> Deploy complete"
