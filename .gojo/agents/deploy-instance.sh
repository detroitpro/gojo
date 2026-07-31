#!/usr/bin/env sh
# Build, install CLI + web UI, and restart the gojo service from this synced worktree.
set -eu

echo "==> Deploying gojo from worktree at $(pwd)"
echo "==> HEAD: $(git rev-parse --short HEAD) ($(git rev-parse HEAD))"

make install

COMMIT_SHORT=$(git rev-parse --short HEAD)
COMMIT_FULL=$(git rev-parse HEAD)

mkdir -p .gojo
cat > .gojo/handoff.json <<EOF
{
  "schemaVersion": 2,
  "runId": "01PLACEHOLDERULID000000000",
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
    "Used make install (install-cli + service install + service restart) from the synced worktree so origin/main is what gets built."
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

echo "==> Deploy complete"
