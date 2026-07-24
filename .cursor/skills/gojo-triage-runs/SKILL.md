---
name: gojo-triage-runs
description: >-
  Triages the live gojo daemon (systemd user unit), journal logs, health,
  doctor, SQLite state, and recent runs. Classifies failures as platform code,
  config/manifest, task/agent, or ops noise. Use when the user asks to triage
  runs, review failed schedules, check daemon health, investigate gojo.service,
  or report what went wrong today/recently.
---

# gojo triage runs

Read-only ops triage of the **running** gojo instance. Report findings to the user; do not change code, restart the service, or re-fire schedules unless asked.

## Preconditions

- Prefer the **systemd user unit** over a local `make dev` process.
- Unit: `gojo.service` (`systemctl --user`).
- Home: `GOJO_HOME` from the unit (usually `~/.gojo`). DB: `$GOJO_HOME/data/gojo.db`.
- CLI: `gojo` on PATH, or `bun run src/cli/index.ts` from the repo with `--home` matching the unit.
- If both systemd and `make dev` are up, say so — they may hit different ports/homes; triage the one the user means (default: systemd).

## Workflow

Copy and track:

```
Triage:
- [ ] 1. Daemon / systemd
- [ ] 2. Health + doctor
- [ ] 3. Journal / logs
- [ ] 4. Recent runs (window)
- [ ] 5. Deep-dive failures
- [ ] 6. Classify + report
```

### 1. Daemon / systemd

```bash
systemctl --user status gojo.service --no-pager
gojo service status
# or: gojo server status
```

Note: Active/running vs enabled-on-login; recent restarts; ExecStart binary path vs repo checkout (stale binary = unfixed bugs still live).

### 2. Health + doctor

```bash
gojo server doctor
# HTTP: GET /api/v1/health and /api/v1/instance/doctor (token if required)
gojo project list
# for failing projects: gojo project doctor <id>
```

Flag: git/disk/database false; agent adapters missing or unauthenticated.

### 3. Journal / logs

```bash
journalctl --user -u gojo.service --since "today" --no-pager
# non-follow snapshot; avoid -f unless watching live
# also: $GOJO_HOME/logs if present
```

Look for scheduler errors, `Invalid run transition`, heal enqueue spam, agent spawn failures, crash loops.

### 4. Recent runs

Default window: **today in local TZ** (or the range the user names).

```bash
gojo run list --output json
```

Join task/project names via DB if needed:

```bash
sqlite3 "$GOJO_HOME/data/gojo.db" "
SELECT substr(r.id,1,12), r.state, t.name, p.name, r.trigger,
       r.started_at, r.finished_at,
       substr(COALESCE(r.error_message,''),1,100)
FROM runs r
JOIN tasks t ON t.id=r.task_id
JOIN projects p ON p.id=r.project_id
WHERE r.created_at >= datetime('now','-1 day')
ORDER BY r.created_at;
"
```

For timing disputes, also read `attempts.agent_duration_ms` / attempt `started_at`–`finished_at` vs run `started_at`–`finished_at`.

Build a **tree**: project → task → runs (id prefix, state, trigger, short error).

### 5. Deep-dive failures

For each distinct failure pattern (not every identical clone):

```bash
gojo run inspect <id> --output json
gojo run logs <id>
gojo run artifacts <id>
# handoff/failure/validation under $GOJO_HOME/artifacts/<runId>/
```

Note `started_at` null (never started) vs agent/validation/integration failures. Check heal children (`trigger=heal`, idempotency `heal:<failedRunId>:…`).

**UI timeline gotchas (run detail):**

- Lanes are phase buckets, not equal to every `RunState`: **Integrate** = `Integrating` + `AwaitingApproval` + `Reporting` merged.
- **Bars** = wall-clock phase duration; **dots** = activity rows (assistant/tools/validation/lifecycle). Header duration ≈ agent time on agent-heavy runs; Integrate is usually short (commit/PR + handoff).
- A huge Integrate bar while Activity shows Succeeded in seconds is usually a **closed-run segment bug**: `terminalRun` used to emit `run.finished` without `run.state_changed → Succeeded`, so Reporting looked “still open” and stretched to *now*. Fixed in `buildPhaseSegments` (honors `run.finished`) + coordinator emit. Prefer DB `finished_at` over the chart when they disagree.
- Run SSE/events are **in-memory** (`EventStore`), not a `run_events` SQLite table. After daemon restart, live event history for old runs may be gone; use Activity only while the process that executed the run is still up, else artifacts + `runs`/`attempts` rows.
- API prefix is `/api/v1/…` (not `/api/runs/…`). Vite proxies to `127.0.0.1:7430`. Auth required for most routes.
- `make dev` vs `gojo.service`: different processes/homes/ports possible — confirm which UI is talking to.

### 6. Classify

| Bucket | Signals | Likely cause |
|--------|---------|--------------|
| **Platform** | Invalid transitions, scheduler throws, crash/restart loops, API 5xx in journal, bug reproducible on any task | gojo code / stale installed binary |
| **Config** | doctor disk/db/git/agents; missing repo path; sync/manifest orphans; wrong `GOJO_HOME` | instance/project setup |
| **Task** | Agent exit ≠0 after start; validation failed with step output; bad prompt/profile; worktree agent errors | task markdown, validation, agent auth in project |
| **Ops** | Abandoned after restart; Canceled; Skipped/Superseded/Blocked by policy | expected lifecycle |
| **Phantom heal** | Heal succeeded after infra fail (`started_at` null / transition error) | platform bug + heal policy; not real task healing |

Cluster identical `error_message` + trigger. One root cause → one write-up.

## Report format (to user)

Keep it pointed:

1. **Verdict** — one sentence (healthy / schedules broken / task noise / …).
2. **Daemon** — systemd state, health/doctor highlights, binary freshness if relevant.
3. **Tree** — indented project → task → runs for the window.
4. **Buckets** — counts + meaning + whether action is needed.
5. **Recommended next** — only if clear (e.g. restart after fix, update service binary, fix task X). Do not implement unless asked.

Missed schedule slots often have burned idempotency keys (`scheduleId:fireAtISO`); say so if re-run is desired.

## Do not

- Edit the plan file or invent fixes while only asked to triage
- `journalctl -f` / long watches unless the user wants live monitoring
- Assume `make dev` is the production daemon when `gojo.service` is active
- Treat every heal success as proof the parent task was fixed
