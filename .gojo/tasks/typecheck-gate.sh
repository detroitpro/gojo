#!/bin/sh
set -eu

mkdir -p .gojo
bun run typecheck

cat > .gojo/handoff.json <<'EOF'
{
  "schemaVersion": 1,
  "runId": "01PLACEHOLDER00000000000000",
  "status": "completed",
  "summary": "Daemon typecheck passed",
  "startingCommit": "unknown",
  "resultCommit": null,
  "filesChanged": [],
  "validation": { "passed": true, "steps": [{ "name": "typecheck", "status": "passed" }] },
  "decisions": [],
  "unresolvedIssues": [],
  "recommendedNextActions": [],
  "agentAssessment": { "successful": true, "confidence": 1 }
}
EOF
