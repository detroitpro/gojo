# Product Requirements Document: Scheduled Software-Agent Orchestration Platform

**Working title:** gojo Scheduler
**Document version:** 0.1
**Target platforms:** Linux and macOS
**Primary interface:** Command-line interface and embedded web application
**Distribution:** Native signed binaries, optionally launched through an `npx` bootstrap package

---

## 1. Executive Summary

gojo Scheduler is a self-hosted platform for scheduling, executing, supervising, and auditing autonomous software-development agents against Git repositories.

The platform allows an operator to define projects, agents, tasks, schedules, validation requirements, Git integration policies, and notification destinations. At the scheduled time, the platform prepares an isolated Git workspace, invokes an agent such as Cursor Agent or Claude Code, records the complete execution history, validates the resulting changes, integrates approved work into the target branch, and communicates the result through Slack, Discord, Telegram, Microsoft Teams, or another configured channel.

The platform must operate in two modes:

1. **Interactive standalone mode**, launched directly from a terminal.
2. **Background service mode**, installed as a `systemd` service on Linux or a `launchd` service on macOS.

The application should be distributed primarily as a native binary rather than as source code. An npm package may provide an `npx`-based installer or launcher, but the npm package should download and execute the correct signed binary for the host operating system and CPU architecture.

The recommended implementation is:

* Bun/TypeScript daemon and CLI (single language across server, CLI, schemas, and adapters)
* Embedded Vue web application (TypeScript; shared schemas with the server)
* SQLite for standalone persistence (`bun:sqlite`)
* Git worktrees for run isolation
* OpenTelemetry for logs, traces, and metrics
* Adapter-based integration with Cursor Agent, Claude Code (prefer TypeScript SDKs where available), and future agents
* Platform-controlled validation and merging
* Native binaries via `bun build --compile` for Linux and macOS
* Optional `npx`, Homebrew, and installation-script distribution channels

---

## 2. Product Vision

The product should function as a dependable operations layer for autonomous development agents.

It should answer the following questions at any time:

* What agents are available?
* What projects can they work on?
* What tasks are scheduled?
* What is running now?
* What did each agent change?
* Did the task actually succeed?
* Which tests and validation steps ran?
* What commit or pull request contains the work?
* What information was passed to the next agent?
* Why did a run fail?
* How much time, compute, and model usage did it consume?
* Who changed the project, task, schedule, or security configuration?
* Has a repeatedly failing task been stopped automatically?

The platform is not merely a cron wrapper around an agent CLI. It is an execution, governance, Git integration, observability, and audit platform.

---

## 3. Product Principles

### 3.1 The agent is not the authority on success

An agent may report that it completed a task, but the platform determines success based on:

* Process exit status
* Required output format
* Repository state
* Validation commands
* Test results
* Policy checks
* Commit creation
* Merge or pull-request status

An agent claiming success does not make a run successful.

### 3.2 Agents do not directly control the target branch

Agents work inside isolated branches and Git worktrees. The platform owns:

* Branch creation
* Commit verification
* Merge serialization
* Conflict detection
* Pull-request creation
* Protected-branch interaction
* Final integration status

This prevents two concurrent agents from independently modifying or merging into the same target branch.

### 3.3 Every execution is reproducible and attributable

Every attempt must record:

* Project revision used as the starting point
* Agent implementation and version
* Model and agent configuration
* Prompt and task definition
* Environment metadata
* Start and completion timestamps
* Commands executed
* Files changed
* Validation results
* Generated commit
* Integration result
* Agent report
* Platform logs and trace identifiers

Secrets must be redacted from these records.

### 3.4 Projects are self-contained, but secrets are not committed

A repository may contain a declarative project file describing:

* Tasks
* Agent roles
* Validation commands
* Repository instructions
* Scheduling defaults
* Merge policies
* Notification routing

Credentials and secrets must remain in the platform’s encrypted secret store or be referenced from an external secret manager.

### 3.5 Scheduled work must be safe to stop

Every running process must support:

* Graceful cancellation
* Forced termination
* Maximum execution duration
* Child-process cleanup
* Crash recovery
* Workspace cleanup
* Run resumption or explicit abandonment

### 3.6 Remote access is secure by default

The server should bind to localhost unless the operator explicitly enables remote access. Exposing a port must require authentication and should normally occur behind HTTPS, a reverse proxy, a VPN, or a secure tunnel.

---

## 4. Goals

### 4.1 Primary goals

The platform must:

1. Schedule recurring or one-time agent tasks.
2. Execute agents against Git repositories.
3. Isolate each run in its own branch and worktree.
4. support Cursor Agent and Claude Code through adapters.
5. Capture structured output and execution history.
6. Run deterministic validation after agent execution.
7. Commit and integrate successful work according to policy.
8. Notify external communication channels.
9. Disable repeatedly failing schedules.
10. Expose CLI and web-based management interfaces.
11. Run interactively or as a background service.
12. Support Linux and macOS.
13. Produce detailed OpenTelemetry-compatible telemetry.
14. Be distributable without requiring users to clone or build source code.
15. Support secure remote access.

### 4.2 Secondary goals

The platform should eventually support:

* Pull-request-based workflows
* GitHub, GitLab, Bitbucket, and Azure DevOps integrations
* Human merge approval
* Multiple hosts or worker nodes
* Containerized execution
* Agent cost and token budgets
* Task dependencies and workflow DAGs
* Event-based triggers
* OIDC or SSO authentication
* Centralized fleet management
* Hosted control-plane deployments

---

## 5. Non-Goals for the Initial Release

The initial release should not attempt to:

* Build a new foundational AI model.
* Replace Cursor Agent, Claude Code, or other coding agents.
* Become a complete CI/CD platform.
* Operate as a general-purpose container orchestrator.
* Support untrusted public users or multi-tenant SaaS workloads.
* Provide high-availability multi-node scheduling.
* Automatically resolve every Git conflict.
* Guarantee that generated code is correct.
* Hide executable logic in a way that prevents reverse engineering.

A compiled binary prevents ordinary source browsing, but any locally distributed executable can still be inspected or reverse engineered.

---

## 6. Users and Roles

### 6.1 Instance administrator

Can:

* Configure the server
* Manage users and API tokens
* Manage secrets
* Install agent adapters
* Configure remote access
* Change global retention and security settings
* View all projects and audit records

### 6.2 Project administrator

Can:

* Register repositories
* Define project agents
* Define tasks and schedules
* Configure validation and merge policies
* Configure project notification channels
* Cancel project runs
* Approve project integrations

### 6.3 Operator

Can:

* View projects and runs
* Start, stop, pause, retry, or cancel tasks
* Review logs and output
* Approve work when authorized
* Temporarily disable schedules

### 6.4 Viewer

Can view:

* Projects
* Schedules
* Run history
* Agent reports
* Validation results
* Audit records permitted by policy

The first release may support a single administrator account, but the data model should not assume that only one user will ever exist.

---

## 7. Core Domain Model

### 7.1 Instance

A running installation of the platform.

### 7.2 Project

A logical software project associated with one primary Git repository.

A project contains:

* Repository configuration
* Default target branch
* Agent profiles
* Task definitions
* Validation profiles
* Integration policies
* Notification routing
* Resource limits
* Project-level instructions

### 7.3 Agent profile

A reusable execution configuration for a particular agent implementation.

Example attributes:

* Adapter type: Cursor, Claude Code, shell, future provider
* Executable path
* Authentication profile
* Model selection
* Permission configuration
* Prompt template
* Environment variables
* MCP configuration
* Timeout
* Resource limits
* Allowed tools
* Allowed network access
* Output-format parser

### 7.4 Task definition

Describes what work must be performed.

A task is separate from its schedule. This allows the same task to be:

* Run manually
* Scheduled multiple ways
* Invoked through an API
* Triggered after another task
* Retried without altering its definition

### 7.5 Schedule

Defines when a task should run.

A schedule contains:

* Cron or interval expression
* Time zone
* Enabled status
* Overlap policy
* Missed-run policy
* Retry policy
* Consecutive-failure threshold
* Backoff behavior
* Optional start and end dates

### 7.6 Run

A logical execution of a task.

A run may contain multiple attempts.

### 7.7 Attempt

A single invocation of an agent for a run.

Retries create additional attempts under the same run rather than overwriting history.

### 7.8 Workspace

The isolated filesystem and Git worktree assigned to an attempt.

### 7.9 Validation profile

An ordered collection of checks such as:

* Dependency installation
* Formatting
* Linting
* Compilation
* Unit tests
* Integration tests
* Static analysis
* Security scanning
* Repository-specific checks

### 7.10 Integration

The operation that moves successful work toward the target branch.

Integration modes:

* No integration
* Commit only
* Create pull request
* Await manual approval
* Squash merge
* Merge commit
* Fast-forward merge

### 7.11 Artifact

A retained output associated with a run, including:

* Agent report
* Structured event output
* Patch file
* Test report
* Coverage report
* Screenshots
* Build output
* Diff summary
* Generated documentation

### 7.12 Notification delivery

A record of an attempted external message, including retries and delivery status.

### 7.13 Audit event

An immutable record of an administrative or system action.

### 7.14 Work item

The canonical operator-facing identity for something being worked on or
delivered. A work item may be a gojo run, pull/merge request, issue, ticket,
incident, deployment, document, or another source-native kind.

Execution, delivery, outcome, and attention are independent axes. Every
external item carries provenance, source identity, native state, observation
time, freshness, and typed links to related work. Stale last-known-open work
must never be reported as verified open.

### 7.15 Project source

A project attachment to an authoritative repository, tracker, deployment,
incident, or other work system. Projects may have multiple sources. Adapters
declare capabilities and preserve source-native state rather than forcing every
system into Git concepts.

Initial source adapters are GitHub, GitLab, Forgejo/Gitea, and a signed generic
work webhook. Polling is the repair loop for readable sources; webhooks provide
low-latency updates.

### 7.16 Work link and event

Work links record causality and provenance (`executes`, `delivers`, `tracks`,
`implements`, `retry-of`, `heals`, `supersedes`). Work events are append-only
semantic lifecycle observations used for durable timeline replay. Raw console
chunks are artifacts/transient output, not authoritative lifecycle state.

### 7.17 Run context

An immutable enqueue-time snapshot of task intent, prompt, manifest hash,
instructions, agent profile/adapter/model configuration, validation and
integration policies, base branch, and schedule. Historical attribution must
survive later project synchronization.

### 7.18 Platform change event

A durable, monotonically ordered invalidation emitted when a mutation changes
an operator-facing read model. The event names the project and entity and
declares affected topics such as dashboard, queue, runs, schedules, work, or
sources.

Authenticated SSE clients resume by sequence after disconnect or daemon
restart. Events invalidate canonical HTTP queries; they do not replace work
events, audit records, or source-native state. Delivery may be coalesced, and a
bounded polling repair loop must cover missed live notifications.

---

## 8. Project Configuration

Each repository should optionally contain a project manifest, for example:

```yaml
version: 1

project:
  name: billing-service
  defaultBranch: main

repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false

instructions:
  files:
    - AGENTS.md
    - docs/architecture.md
  scheduledRunNotice: |
    You are executing an unattended scheduled task.
    A future agent may inspect and continue this work.
    Produce a complete structured handoff report.

agents:
  maintenance:
    adapter: claude-code
    model: default
    timeout: 45m
    permissions:
      filesystem: project
      shell: allowlisted
      network: restricted

  reviewer:
    adapter: cursor
    timeout: 30m
    readOnly: true

validationProfiles:
  standard:
    steps:
      - name: install
        command: pnpm install --frozen-lockfile
        timeout: 10m

      - name: lint
        command: pnpm lint
        timeout: 10m

      - name: test
        command: pnpm test
        timeout: 20m

      - name: build
        command: pnpm build
        timeout: 20m

tasks:
  dependency-maintenance:
    description: Review and safely update outdated dependencies.
    agent: maintenance
    promptFile: .gojo/tasks/dependency-maintenance.md
    validationProfile: standard

    concurrency:
      projectLimit: 1
      overlapPolicy: skip

    integration:
      mode: pull-request
      targetBranch: main
      requireAllValidations: true

    failurePolicy:
      maxAttemptsPerRun: 2
      disableAfterConsecutiveFailedRuns: 3
      backoff: exponential

schedules:
  dependency-maintenance:
    task: dependency-maintenance
    cron: "0 3 * * 1"
    timezone: America/Detroit

notifications:
  onSuccess:
    - engineering-slack
  onFailure:
    - engineering-slack
    - operations-teams
  onDisabled:
    - operations-teams
```

The platform database remains authoritative for runtime state. The repository manifest defines desired project behavior and may be synchronized into the database.

Conflicts between repository configuration and administrative overrides must be visible and auditable.

---

## 9. Agent Adapter Architecture

The system must not directly embed assumptions about one agent CLI throughout the scheduler.

Each agent implementation should conform to an internal adapter interface.

### 9.1 Adapter responsibilities

An adapter must provide:

* Installation detection
* Version detection
* Authentication-state detection
* Capability discovery
* Command construction
* Environment preparation
* Prompt delivery
* Standard input handling
* Output parsing
* Structured event conversion
* Cancellation handling
* Exit-status interpretation
* Upgrade compatibility checks
* Secret-redaction hints

### 9.2 Initial adapters

#### Cursor Agent adapter

Cursor Agent currently supports interactive and non-interactive terminal execution, project-level rules, and machine-consumable output modes.

#### Claude Code adapter

Claude Code provides a terminal-based coding agent capable of editing files and executing commands. The adapter should use non-interactive execution and structured output where supported.

#### Shell adapter

A generic shell adapter enables:

* Testing the orchestration platform
* Running deterministic scripts
* Supporting custom agent wrappers
* Integrating future agents without immediately creating a native adapter

### 9.3 Version compatibility

Agent CLIs can change independently from this platform. Therefore:

* Each adapter must declare supported version ranges.
* Unsupported versions should generate a warning or block execution according to policy.
* Detected CLI versions must be recorded on every attempt.
* Adapter behavior must be covered by contract tests.
* Auto-updating agent CLIs should be detectable because unexpected upgrades can affect reproducibility.

---

## 10. Run Lifecycle

Every run should follow an explicit state machine.

### 10.1 Run states

```text
Scheduled
    |
    v
Queued
    |
    v
Preparing
    |
    v
Running
    |
    v
Validating
    |
    +--------------------+
    |                    |
    v                    v
AwaitingApproval       Failed
    |
    v
Integrating
    |
    v
Reporting
    |
    +--------------------+
    |                    |
    v                    v
Succeeded              Failed
```

Additional terminal states:

* Canceled
* Timed out
* Skipped
* Superseded
* Abandoned
* Blocked
* Conflict
* Infrastructure failure

### 10.2 Detailed execution sequence

#### Step 1: Trigger

A run is created by:

* Schedule
* Manual command
* Web interface
* API request
* Future webhook or workflow dependency

The trigger produces a unique idempotency key.

#### Step 2: Admission control

The scheduler evaluates:

* Is the task enabled?
* Is the schedule enabled?
* Is another instance already running?
* Has the project reached its concurrency limit?
* Is the agent available?
* Is the repository accessible?
* Has a maintenance window blocked execution?
* Has the cost or resource budget been exhausted?

#### Step 3: Repository synchronization

The workspace manager:

1. Obtains a project repository lock.
2. Fetches remote changes.
3. Verifies the configured target branch.
4. Records the exact starting commit.
5. Ensures the base repository is in an acceptable state.
6. Creates a unique run branch.
7. Creates an isolated worktree.

Git supports multiple linked working trees attached to one repository, making worktrees an appropriate isolation mechanism for concurrent branches.

Example branch:

```text
gojo/dependency-maintenance/2026-07-23/run-01K123ABC
```

#### Step 4: Run context construction

The platform generates a run context containing:

* Task description
* Project instructions
* Starting commit
* Target branch
* Previous relevant run summaries
* Previous unresolved findings
* Validation expectations
* Output-report requirements
* Time and resource budget
* Security and permission restrictions
* Explicit notice that the execution is scheduled and unattended

#### Step 5: Agent execution

The platform:

* Starts the adapter process
* Captures stdout and stderr
* Parses structured events
* Correlates events with the run trace
* Enforces timeout and cancellation
* Monitors process health
* Tracks child processes
* Records resource usage
* Redacts configured secrets

#### Step 6: Agent handoff report

Before completing, the agent is instructed to produce a structured report.

The report must include:

* Completion status
* Summary
* Files changed
* Decisions made
* Commands run
* Tests run
* Known failures
* Unresolved issues
* Assumptions
* Recommended follow-up
* Whether another agent should continue the work

The report should be stored by the platform, not necessarily committed to the application repository.

#### Step 7: Repository inspection

The platform independently determines:

* Whether files changed
* Whether untracked files exist
* Whether prohibited files changed
* Whether secrets appear in the diff
* Whether the agent created unexpected commits
* Whether the branch contains only expected ancestry
* Whether the worktree remains valid

#### Step 8: Validation

The platform executes validation steps outside the conversational agent process.

A validation result includes:

* Command
* Working directory
* Start and end time
* Exit code
* Truncated console summary
* Full output artifact
* Timeout status
* Required or advisory status

#### Step 9: Commit

If changes are valid, the platform creates or verifies a commit containing:

* Task identifier
* Run identifier
* Agent adapter and version
* Starting commit
* Validation summary
* Trace identifier

The agent may propose a commit message, but the platform should enforce a consistent format.

#### Step 10: Integration

The platform applies the configured integration policy.

Before integration, it must:

1. Refresh the target branch.
2. Detect target-branch movement.
3. Rebase or merge only according to policy.
4. Rerun required validation if the base changed.
5. Acquire the project merge lock.
6. Integrate or create a pull request.
7. Record the final commit or pull-request identifier.

#### Step 11: Notification

The notification service sends a structured result.

#### Step 12: Cleanup

The platform removes the worktree according to retention policy.

Failed worktrees may be retained temporarily for diagnosis.

---

## 11. Git and Workstream Strategy

The term **workstream** should map to a concrete Git branch and worktree.

### 11.1 Isolation model

Every attempt receives:

* A unique branch
* A unique worktree
* A unique filesystem path
* A unique run identifier
* A fixed starting commit

No two active attempts should write to the same worktree.

### 11.2 Merge ownership

Agents should not execute unrestricted commands such as:

```text
git push origin main
git merge ...
git reset --hard origin/main
```

The platform should own those operations.

### 11.3 Integration modes

#### Mode A: Report only

The agent performs analysis but cannot modify the repository.

#### Mode B: Commit only

Changes are committed to a run branch but not pushed or merged.

#### Mode C: Pull request

The platform pushes the branch and creates a pull request.

Recommended for shared repositories.

#### Mode D: Manual approval

The platform completes validation and waits for an operator.

#### Mode E: Automatic integration

The platform automatically integrates after all required checks pass.

Recommended only for trusted, narrowly scoped tasks.

### 11.4 Merge queue

Each project requires a serialized integration queue.

Without this queue, two agents can:

1. Start from the same commit.
2. Produce independently valid changes.
3. Attempt to merge concurrently.
4. Invalidate one another’s test results.

The merge queue must reevaluate the branch against the latest target branch before integration.

### 11.5 Conflict behavior

Configurable choices:

* Fail and request human intervention
* Requeue against the new target branch
* Ask the same agent to resolve the conflict
* Start a new attempt with conflict context
* Create a pull request marked as conflicted

The default should not permit autonomous force-pushing to a protected target branch.

---

## 12. Scheduling Requirements

### 12.1 Schedule types

The initial release must support:

* Standard cron expressions
* Fixed intervals
* One-time execution
* Manual execution

Later releases may support:

* Git push events
* Pull-request events
* Issue events
* Webhooks
* File changes
* Completion of another task
* External monitoring conditions

### 12.2 Time zones and daylight saving time

Every schedule must have an explicit time zone.

The scheduler must define behavior for:

* A local time that occurs twice
* A local time that does not occur
* System clock changes
* Service downtime
* Host suspension and resume

### 12.3 Missed-run policies

Supported policies:

* Skip missed executions
* Run once after recovery
* Run every missed occurrence
* Run only the most recent missed occurrence

Default: run the most recent missed occurrence once.

### 12.4 Overlap policies

Supported policies:

* Skip the new run
* Queue the new run
* Cancel and replace the current run
* Allow parallel execution

Default: queue one run and coalesce additional occurrences.

### 12.5 Retry policies

Retry configuration must distinguish:

* Agent task failure
* Validation failure
* Merge conflict
* Authentication failure
* Network failure
* Repository failure
* Platform infrastructure failure
* Notification failure

A notification failure should not change a successful code run into a failed code run.

### 12.6 Automatic disabling

A schedule may be disabled after a configurable number of consecutive failed runs.

Recommended default:

```text
3 consecutive failed runs
```

When disabled, the platform must:

* Record the disabling event
* Send a high-priority notification
* Explain the failure sequence
* Preserve the next scheduled time for reference
* Require explicit operator re-enablement
* Optionally run a health check before re-enablement

A successful run resets the consecutive-failure counter.

---

## 13. Definition of Success

Every task must define its success contract.

A success contract may require:

* Agent exited successfully
* Structured report was produced
* Repository changed, or explicitly allowed no-change result
* No prohibited files changed
* No secret scanning violations
* Required validations passed
* Commit was created
* Pull request was created
* Merge completed
* Target branch contains the resulting commit
* Required notification was queued

The platform must distinguish:

* **Agent success:** the agent process says it completed.
* **Validation success:** deterministic checks passed.
* **Integration success:** the work reached its configured destination.
* **Run success:** all required stages completed.

This distinction is essential for reliable reporting.

---

## 14. Agent Handoff Contract

Future agents should not need to reconstruct previous activity entirely from Git history and raw logs.

Each completed attempt should produce a normalized handoff document:

```json
{
  "schemaVersion": 2,
  "runId": "01K123ABC",
  "status": "completed",
  "summary": "Updated three dependencies and corrected two incompatible API calls.",
  "startingCommit": "abc123",
  "resultCommit": "def456",
  "filesChanged": [
    "package.json",
    "pnpm-lock.yaml",
    "src/client.ts"
  ],
  "validation": {
    "passed": true,
    "steps": [
      {
        "name": "lint",
        "status": "passed"
      },
      {
        "name": "test",
        "status": "passed"
      }
    ]
  },
  "decisions": [
    "Did not upgrade package X because version 5 requires a framework migration."
  ],
  "unresolvedIssues": [
    "Package Y remains deprecated and needs replacement."
  ],
  "recommendedNextActions": [
    "Create a separate migration task for package Y."
  ],
  "agentAssessment": {
    "successful": true,
    "confidence": 0.86
  },
  "impact": {
    "items": [
      {
        "category": "dependency-update",
        "subject": "croner",
        "summary": "Upgraded croner 8.1.0 -> 9.0.2",
        "confidence": 0.9,
        "evidence": {
          "files": ["package.json", "pnpm-lock.yaml"],
          "validationSteps": ["test"],
          "references": []
        }
      }
    ]
  },
  "assets": [
    {
      "role": "pr-body",
      "path": ".gojo/assets/pr-body.md",
      "mediaType": "text/markdown",
      "label": "PR description"
    }
  ]
}
```

Optional `assets` attach files or inline blobs for downstream use. Roles:

* `pr-body` — preferred GitHub PR body (verbose markdown); gojo still appends a short footer
* `pr-title` — preferred PR title (first line)
* `report` / `attachment` — stored under run artifacts for humans and later agents

Prefer workspace-relative `path` for large markdown; use `content` for small inline text. At least one of `path` or `content` is required. gojo materializes assets into `$GOJO_HOME/artifacts/<runId>/assets/` when writing `handoff.json`.

### Impact accounting (schema v2)

Schema v2 adds optional `impact.items`: one structured claim per **concrete subject** (one package, one issue id, one doc page). Agents must not submit aggregate totals or speculative/duplicate claims. Categories: `dependency-update`, `bug-fix`, `bug-prevention`, `documentation`, `test-coverage`, `security`, `feature`, `performance`, `maintenance`.

The platform assigns trust levels rather than accepting claims at face value:

* **verified** — machine-detected from the observed diff (dependency manifests, docs, test files), or an agent claim matching a platform fact
* **corroborated** — agent claim whose `evidence.files` intersect the actual changed files
* **claimed** — everything else (typical for subjective categories such as `bug-prevention`)

Schema v1 handoffs (no `impact`) remain valid; invalid impact metadata is dropped with a recorded normalization warning and never fails otherwise valid work. Merge outcomes are tracked separately from run success: a run counts as "merged automation" only when its integration record reaches `merged` (direct auto-merge, or PR merge observed by the reconciler) — never because the run succeeded.

The platform should provide future agents with:

* Most recent successful run
* Most recent failed run
* Unresolved findings
* Current project state
* Changes since the previous run

Raw historical transcripts should not automatically be inserted into every future prompt because they may be large, noisy, expensive, or contain stale instructions.

---

## 15. Notification System

### 15.1 Initial connectors

* Slack
* Discord
* Microsoft Teams
* Telegram
* Generic webhook

### 15.2 Notification events

* Run queued
* Run started
* Run completed
* Run failed
* Run timed out
* Run canceled
* Validation failed
* Merge conflict
* Approval required
* Pull request created
* Schedule disabled
* Agent unavailable
* Repository authentication failed
* Platform update available

### 15.3 Message contents

A result notification should include:

* Project
* Task
* Agent
* Status
* Duration
* Starting and resulting commit
* Validation summary
* Files changed
* Short agent summary
* Pull-request or run link
* Failure reason
* Retry count
* Whether the schedule remains enabled

### 15.4 Delivery reliability

Notifications require their own delivery queue with:

* Retry policy
* Exponential backoff
* Per-channel rate limiting
* Delivery status
* Dead-letter state
* Operator retry action

Notification credentials must never appear in logs.

---

## 16. Web Application

The web UI should be compiled and embedded into the binary.

### 16.1 Primary views

#### Dashboard

Shows:

* Running agents
* Queued runs
* Failed runs
* Disabled schedules
* Projects requiring attention
* Recent successful integrations
* Resource and cost summaries

#### Projects

Shows:

* A command center split into Now, Needs attention, Delivery, and History
* Feature/focus, assigned agent or actor, phase, provenance, and latest activity
* Source connection health, observation time, errors, and backfill progress
* Verified-open and stale-last-known-open counts as separate values
* Repository status
* Target branch
* Assigned agents
* Tasks
* Schedules
* Validation profiles
* Recent runs
* Current worktrees
* Integration queue

#### Agents

Shows:

* Adapter
* Installation status
* Version
* Authentication status
* Capabilities
* Current assignment
* Last execution
* Health
* Supported project permissions

#### Runs

Shows:

* State timeline
* Live output
* Structured agent events
* Git diff
* Validation steps
* Artifacts
* Agent handoff report
* Notifications
* Audit events
* Trace identifier

#### Schedules

Allows operators to:

* Create
* Edit
* Pause
* Resume
* Disable
* Run immediately
* View upcoming occurrences
* View failure count
* Change retry and overlap policies

#### Approvals

Shows work awaiting:

* Merge approval
* Permission escalation
* Conflict resolution
* Retry approval

#### Settings

Includes:

* Server
* Storage
* Authentication
* Telemetry
* Retention
* Updates
* Notification connectors
* Secret references

### 16.2 Live communication

Use Server-Sent Events or WebSockets for:

* Live run logs
* Run-state changes
* Validation progress
* Agent status
* Cancellation acknowledgement

The normal management API should remain HTTP-based and independently usable by the CLI.

### 16.3 API specification

The server should publish an OpenAPI document for its HTTP API. OpenAPI provides a language-independent description of HTTP service capabilities.

---

## 17. CLI Requirements

Example executable name:

```text
gojo
```

### 17.1 Server commands

```text
gojo server start
gojo server status
gojo server stop
gojo server doctor
```

### 17.2 Service commands

```text
gojo service install
gojo service uninstall
gojo service start
gojo service stop
gojo service restart
gojo service logs
```

The installer should create:

* A `systemd` unit on Linux
* A `launchd` plist on macOS

### 17.3 Project commands

```text
gojo project add
gojo project list
gojo project inspect <project>
gojo project sync <project>
gojo project doctor <project>
gojo project remove <project>
```

### 17.4 Agent commands

```text
gojo agent detect
gojo agent list
gojo agent inspect <agent>
gojo agent test <agent>
gojo agent authenticate <agent>
```

### 17.5 Task and schedule commands

```text
gojo task list
gojo task run <project>/<task>
gojo task cancel <run-id>
gojo task retry <run-id>

gojo schedule list
gojo schedule enable <schedule>
gojo schedule disable <schedule>
gojo schedule pause <schedule>
gojo schedule next <schedule>
```

### 17.6 Run commands

```text
gojo run list
gojo run inspect <run-id>
gojo run logs <run-id> --follow
gojo run diff <run-id>
gojo run approve <run-id>
gojo run reject <run-id>
gojo run artifacts <run-id>
```

### 17.7 Machine-readable output

All CLI commands should support:

```text
--output text
--output json
--output yaml
```

Commands must return documented exit codes for use in scripts.

---

## 18. Process and Execution Management

Because agents can execute shell commands, process control is a foundational security and reliability concern.

The execution engine must:

* Launch each attempt in a separate process group
* Track child processes
* Send graceful termination first
* Force-kill after a configured grace period
* Prevent orphaned processes
* Capture stdout and stderr separately
* Limit output volume
* Enforce execution timeout
* Enforce disk-use limits
* Track CPU and memory where supported
* Use a minimal environment
* Control inherited credentials
* Set an explicit working directory
* Record the effective executable and arguments
* Redact sensitive arguments

Later versions should support OCI container execution for stronger isolation.

---

## 19. Security Requirements

### 19.1 Threat model

The platform intentionally runs software-development agents that may execute repository commands. It must therefore assume:

* Repository content may contain malicious instructions.
* Dependencies may execute install scripts.
* Agent output may contain secrets.
* An agent may attempt commands outside its assigned workspace.
* A compromised integration token may modify remote repositories.
* Remote users may attempt to invoke arbitrary tasks.
* Notification endpoints may be unavailable or compromised.

### 19.2 Permission profiles

Each agent profile should define:

* Filesystem scope
* Shell-command policy
* Network policy
* Secret access
* Repository write access
* Remote Git permissions
* Allowed MCP servers
* Maximum runtime
* Maximum output
* Approval requirements

### 19.3 Secret handling

Secrets must:

* Be encrypted at rest
* Be referenced by identifier
* Be scoped by project and agent
* Be injected only at execution time
* Be redacted from logs
* Be excluded from handoff reports
* Support rotation
* Record access in the audit log

The project manifest should contain secret references, never secret values.

### 19.4 Remote authentication

The initial release should support:

* Local administrator creation
* Password hashing using a modern password-hashing algorithm
* API tokens with scopes
* Session expiration
* CSRF protection
* Rate limiting
* Secure cookies
* Audit logging

Later releases should add:

* OIDC
* SAML where commercially necessary
* Hardware-backed authentication
* Organization-level RBAC

### 19.5 Network binding

Default behavior:

```text
127.0.0.1:<configured-port>
```

Remote binding must require explicit configuration.

The server should support:

* Trusted reverse-proxy configuration
* Forwarded-header validation
* Configurable allowed origins
* TLS certificate configuration
* Secure tunnel deployment
* IP allowlists

### 19.6 Emergency controls

The platform must provide:

* Global pause
* Project pause
* Agent disable
* Schedule disable
* Immediate run cancellation
* Disable-all-integrations mode
* Read-only maintenance mode

---

## 20. Audit and Observability

OpenTelemetry should be the standard instrumentation layer. OpenTelemetry is designed to produce and export vendor-neutral traces, metrics, and logs, including correlation between those signals.

### 20.1 Traces

A run should be represented as a root trace.

Suggested child spans:

```text
run
├── admission
├── repository.fetch
├── workspace.create
├── context.build
├── agent.execute
├── repository.inspect
├── validation.install
├── validation.lint
├── validation.test
├── validation.build
├── commit.create
├── integration.rebase
├── integration.merge
├── notification.send
└── workspace.cleanup
```

### 20.2 Metrics

Recommended metrics:

* Runs started
* Runs succeeded
* Runs failed
* Runs canceled
* Run duration
* Queue duration
* Agent duration
* Validation duration
* Merge duration
* Consecutive task failures
* Active workspaces
* Active agents
* Process crashes
* Notification failures
* Repository conflicts
* Bytes logged
* Artifact storage
* Agent tokens and estimated cost when available

Avoid putting high-cardinality values such as raw run IDs into metric labels. Store those values in traces and logs instead.

### 20.3 Structured logs

Every log record should include relevant fields such as:

* Instance ID
* Project ID
* Task ID
* Schedule ID
* Run ID
* Attempt ID
* Agent ID
* Workspace ID
* Trace ID
* Span ID
* Severity
* Event type

### 20.4 Audit log

Audit events must include:

* Actor
* Action
* Target
* Previous value
* New value
* Timestamp
* Source IP where applicable
* Authentication method
* Correlation ID
* Success or failure

Audit records should be append-only through the normal application interface.

---

## 21. Persistence and Storage

### 21.1 Initial database

Use SQLite in WAL mode for the standalone release.

SQLite is appropriate for:

* One installed instance
* One active scheduler
* Local administration
* Moderate run volume
* Simple backup and recovery
* Binary distribution without another required service

The persistence layer should use repository interfaces that permit a later PostgreSQL implementation.

### 21.2 Filesystem storage

Store larger artifacts outside the relational database.

Suggested layout:

```text
~/.gojo/
├── config/
├── data/
│   └── gojo.db
├── repositories/
├── worktrees/
├── artifacts/
├── logs/
├── cache/
├── secrets/
└── updates/
```

### 21.3 Retention

Configurable retention should cover:

* Successful run logs
* Failed run logs
* Worktrees
* Agent transcripts
* Validation artifacts
* Patches
* Audit records
* Notification records

Audit records should have a longer retention period than ordinary console output.

### 21.4 Backups

The CLI should provide:

```text
gojo backup create
gojo backup verify
gojo backup restore
```

Backups should include:

* Database
* Configuration
* Encrypted secrets
* Required artifacts

Repository clones and disposable worktrees do not necessarily need to be backed up.

---

## 22. Distribution Strategy

### 22.1 Primary release artifacts

Produce signed binaries for:

* Linux x86-64
* Linux ARM64
* macOS Intel
* macOS Apple Silicon

Each release should include:

* Binary
* Version metadata
* Checksums
* Cryptographic signature
* Release manifest
* Software bill of materials
* Upgrade and rollback metadata

### 22.2 `npx` distribution

`npx` executes package-provided binaries and may fetch the package from the npm registry. It is therefore a useful launcher, not a mechanism that inherently conceals package contents.

Recommended flow:

```text
npx @gojo/cli
        |
        v
Detect operating system and architecture
        |
        v
Resolve approved gojo version
        |
        v
Download signed native binary
        |
        v
Verify checksum and signature
        |
        v
Cache binary
        |
        v
Execute native binary
```

The npm package should contain only:

* Bootstrap logic
* Release-manifest verification
* Download logic
* Cache management
* Version-selection logic

It should not contain the full application implementation.

### 22.3 Other distribution channels

Recommended:

* Direct binary download
* Installation shell script
* Homebrew tap
* `npx` bootstrapper
* Container image for server deployments

Possible later channels:

* Debian package
* RPM package
* macOS signed installer
* Managed enterprise installer

### 22.4 Node single-executable alternative

Node supports building single-executable applications, but current Node documentation still classifies parts of the direct SEA build workflow as active development. This makes it a weaker foundation than Bun or Deno compile for the first production distribution system.

### 22.5 Recommended implementation language

**Recommendation: Bun (TypeScript).**

Reasons:

* Single language across daemon, CLI, shared schemas, adapters, and web UI contracts
* `bun build --compile` produces signed cross-platform native binaries without requiring Bun or Node on the target machine
* First-class TypeScript, built-in SQLite (`bun:sqlite`), and strong subprocess APIs for agent supervision
* Aligns with the agent ecosystem: Claude Code’s CLI is Bun-compiled; Agent SDKs are TypeScript-first
* Shared Zod (or equivalent) schemas eliminate Go/TS contract duplication for handoff reports, OpenAPI types, and manifests
* Fast iteration for MVP delivery without sacrificing a binary distribution story

The embedded web UI uses Vue and TypeScript. Compiled static assets are embedded into the Bun-compiled executable.

**Alternatives considered:**

* **Deno:** Mature `deno compile` and a permission sandbox; rejected for larger default npm-embed binaries (experimental `--bundle`), weaker drop-in npm fidelity for agent SDKs/native addons, and less alignment with agent toolchains that target Bun/Node first.
* **Go:** Excellent small binaries and process control; rejected because a Go core plus Vue/TS UI forces duplicated schemas and blocks direct TypeScript Agent SDK integration.
* **Node SEA:** Still marked as evolving; weaker packaging foundation than Bun compile.

---

## 23. Reference Architecture

```text
                         Remote Browser
                              |
                     HTTPS / Reverse Proxy
                              |
                              v
+------------------------------------------------------------------+
|                    gojo Process (Bun binary)                     |
|                                                                  |
|  +----------------+       +----------------------------------+   |
|  | Embedded Vue UI| ----> | HTTP API / SSE / Authentication |   |
|  +----------------+       +----------------------------------+   |
|                                      |                           |
|                                      v                           |
|  +------------+   +-----------+   +--------------------------+  |
|  | Scheduler  |-->| Run Queue |-->| Run Coordinator          |  |
|  +------------+   +-----------+   +--------------------------+  |
|                                      |                           |
|              +-----------------------+------------------+        |
|              |                       |                  |        |
|              v                       v                  v        |
|     +----------------+     +------------------+  +------------+ |
|     | Workspace/Git  |     | Agent Adapters   |  | Validation | |
|     | Manager        |     | Cursor / Claude  |  | Engine     | |
|     +----------------+     +------------------+  +------------+ |
|              |                       |                  |        |
|              +-----------------------+------------------+        |
|                                      |                           |
|                                      v                           |
|                          +------------------------+              |
|                          | Integration/Merge Queue|              |
|                          +------------------------+              |
|                                      |                           |
|             +------------------------+------------------+        |
|             |                        |                  |        |
|             v                        v                  v        |
|    +----------------+      +----------------+  +---------------+|
|    | SQLite         |      | Artifact Store |  | Notifications ||
|    +----------------+      +----------------+  +---------------+|
|             |                        |                  |        |
|             +------------------------+------------------+        |
|                                      |                           |
|                                      v                           |
|                       OpenTelemetry Instrumentation              |
+------------------------------------------------------------------+
             |                       |                  |
             v                       v                  v
       Git repository         Agent subprocesses    Slack/Discord/
                                                    Teams/Telegram
```

### 23.1 Internal modules

The initial codebase should maintain clear package boundaries:

```text
src/
  cli/
  api/
  auth/
  audit/
  config/
  scheduler/
  runs/
  agents/
    adapter/
    cursor/
    claude/
    shell/
  workspace/
  git/
  validation/
  integration/
  notifications/
  secrets/
  telemetry/
  storage/
  artifacts/
  updates/
  service/
  shared/          # Zod schemas shared with web UI
web/               # Vue 3 + TypeScript SPA
```

Prefer Web-standard and `node:` APIs where practical; confine Bun-specific APIs (`bun:sqlite`, `Bun.spawn`, compile embedding) behind interfaces so storage and process supervision remain testable. The scheduler must not call Cursor or Claude directly. It creates runs. The run coordinator selects an adapter through an interface.

---

## 24. Reliability Requirements

### 24.1 Crash recovery

After restart, the platform must identify runs left in nonterminal states.

It should determine whether:

* The process still exists
* The worktree still exists
* The repository contains a result commit
* Validation completed
* Integration completed
* Notification delivery remains pending

The system must not silently mark an interrupted run successful.

### 24.2 Idempotency

Operations requiring idempotency include:

* Schedule triggering
* Run creation
* Commit creation
* Pull-request creation
* Merge execution
* Notification delivery
* Automatic schedule disabling

### 24.3 Scheduler leadership

The first release should enforce one active scheduler per database.

A database lease or process lock should prevent two server processes from independently triggering the same schedules.

### 24.4 Disk protection

The platform must monitor:

* Worktree size
* Artifact size
* Log size
* Available disk
* Repository-cache size

New runs should be blocked before the host reaches a critically low disk threshold.

---

## 25. Product Gaps and Frequently Missed Requirements

The original concept is strong, but the following issues require explicit product decisions.

### 25.1 Who determines success?

The agent cannot be the sole source of truth. Each task needs a deterministic success contract.

### 25.2 What happens when two runs overlap?

Tasks need overlap, queueing, and project-concurrency policies.

### 25.3 What happens when `main` changes during a run?

The platform needs a merge queue and base-revalidation policy.

### 25.4 Should agents really merge their own work?

They should not. Agents should produce changes; the platform should integrate them.

### 25.5 What is trusted?

Repository files, issue descriptions, dependency scripts, and agent output may all contain hostile or misleading instructions.

### 25.6 How are credentials scoped?

An agent updating documentation should not automatically receive production deployment credentials.

### 25.7 How does a future agent understand previous work?

The platform needs a structured handoff contract, not only raw transcripts.

### 25.8 What happens when the host restarts?

Schedules, active runs, subprocesses, and temporary workspaces require recovery rules.

### 25.9 How are agent upgrades handled?

A silent Cursor or Claude CLI upgrade may change output formats, permissions, or behavior.

### 25.10 How are costs controlled?

Tasks may require:

* Token limits
* Monetary budgets
* Runtime limits
* Daily run quotas
* Maximum retries
* Model restrictions

### 25.11 How are no-change runs classified?

Some tasks succeed by determining that nothing needs to change. “No Git diff” must not automatically mean failure.

### 25.12 How are long-running commands handled?

The platform needs output limits, heartbeat detection, timeouts, and cancellation.

### 25.13 What happens to partial work?

The operator may need to:

* Retain the worktree
* Download a patch
* Retry from the same branch
* Start over from the target branch
* Assign another agent
* Convert the failed run into a manual review

### 25.14 How does remote access work safely?

Listening on `0.0.0.0` without authentication is not acceptable for a system capable of executing repository commands.

### 25.15 What licenses and accounts are required?

The platform should not assume it has permission to redistribute third-party agent executables. Initial integrations should invoke separately installed and authenticated CLIs.

### 25.16 What repository features must be supported?

Explicit decisions are required for:

* Git submodules
* Git LFS
* Sparse checkout
* Monorepos
* Very large repositories
* Detached HEAD states
* Protected branches
* Signed commits
* Commit hooks
* Multiple remotes

### 25.17 Are generated commands allowed to access the public network?

Network policy must be configurable by project and task.

### 25.18 Can the agent alter its own platform configuration?

By default, agents should not be allowed to modify gojo configuration, executable files, service definitions, credentials, or other projects.

---

## 26. MVP Scope

### 26.1 Included

The MVP should include:

* One local gojo instance
* Linux and macOS binaries
* CLI
* Embedded web UI
* SQLite persistence
* Local account authentication
* Local or remotely cloned Git repositories
* Git worktree isolation
* Cursor Agent adapter
* Claude Code adapter
* Shell adapter
* Manual and cron-based runs
* Task time zones
* Queue and overlap policies
* Configurable retries
* Automatic disabling after repeated failures
* Validation command pipelines
* Commit-only, pull-request, and auto-merge modes
* Single-project merge queue
* Structured agent reports
* Run history
* Live logs
* Slack and generic webhook notifications
* OpenTelemetry traces, metrics, and logs
* `systemd` and `launchd` installation
* Native release binaries
* `npx` bootstrap installer
* Backup and restore commands
* Global emergency pause

### 26.2 Excluded from MVP

Defer:

* Multi-node workers
* SaaS multi-tenancy
* Kubernetes deployment
* Full workflow DAGs
* Marketplace for agent adapters
* Enterprise SSO
* Complex container sandbox management
* Mobile application
* Arbitrary event triggers
* Automated conflict-resolution agents
* Cross-project task dependencies

---

## 27. Suggested Delivery Phases

### Phase 1: Execution foundation

Build:

* CLI framework
* Configuration system
* SQLite storage
* Project registration
* Git repository manager
* Worktree creation
* Shell adapter
* Basic run state machine
* Console logging

Success criterion: a manually invoked shell task can modify an isolated branch, run validation, commit, and produce a run record.

### Phase 2: Agent integration

Build:

* Cursor adapter
* Claude Code adapter
* Adapter contract tests
* Structured output parsing
* Agent handoff schema
* Timeout and cancellation
* Secret redaction

Success criterion: either agent can complete a non-interactive repository task with captured output and a structured report.

### Phase 3: Scheduling and reliability

Build:

* Cron scheduling
* Time zones
* Queue policies
* Retries
* Consecutive-failure disabling
* Crash recovery
* Project locks
* Merge queue

Success criterion: scheduled tasks run without duplication and disable themselves after the configured failure threshold.

### Phase 4: Web management

Build:

* Embedded Vue application
* HTTP API
* Authentication
* Dashboard
* Project screens
* Task and schedule screens
* Live run viewer
* Approval workflow

Success criterion: the platform can be administered remotely without terminal access.

### Phase 5: Integrations and observability

Build:

* OpenTelemetry instrumentation
* Slack
* Discord
* Teams
* Telegram
* Generic webhooks
* Artifact retention
* Operational dashboards

Success criterion: every run can be traced across scheduling, agent execution, validation, integration, and notification.

### Phase 6: Packaging and hardening

Build:

* Signed release pipeline
* macOS notarization
* Linux packages
* `npx` bootstrapper
* Homebrew formula
* Update and rollback mechanism
* Backup and restore
* Security review

Success criterion: a new user can install the product without downloading source or manually configuring a runtime.

---

## 28. MVP Acceptance Criteria

The MVP is complete when an operator can:

1. Install gojo on Linux or macOS from a native binary or `npx` bootstrapper.
2. Install it as a background service.
3. Register a Git repository.
4. Detect an installed Cursor Agent or Claude Code CLI.
5. Define an agent profile.
6. Define a task and validation pipeline.
7. Schedule the task in an explicit time zone.
8. Observe the upcoming run in the web interface.
9. Have the platform create an isolated worktree and branch.
10. Run the agent without interactive input.
11. View live structured output remotely.
12. Cancel the run.
13. Run deterministic validation.
14. Review the agent handoff report.
15. Commit successful changes.
16. Merge or create a pull request according to policy.
17. Receive a notification.
18. View the complete historical record.
19. Retry a failed run.
20. Automatically disable a schedule after repeated failures.
21. Restart the server without duplicating or losing scheduled work.
22. Export telemetry to an OpenTelemetry-compatible collector.
23. Back up and restore the instance.

---

## 29. Recommended Initial Technical Decisions

| Area                  | Recommendation                                           |
| --------------------- | -------------------------------------------------------- |
| Core implementation   | Bun + TypeScript (strict)                                |
| Runtime / package mgr | Bun                                                      |
| Schemas               | Zod shared between server, CLI, and web UI               |
| Web UI                | Vue 3 and TypeScript                                     |
| UI delivery           | Static assets embedded in Bun-compiled binary            |
| Database              | SQLite with WAL (`bun:sqlite`)                           |
| Future database       | PostgreSQL                                               |
| API                   | HTTP JSON with OpenAPI                                   |
| Live updates          | Server-Sent Events initially                             |
| Scheduling            | Persistent cron scheduler with database leases           |
| Git isolation         | One worktree per attempt                                 |
| Agent execution       | Supervised subprocess / TypeScript SDK adapters          |
| Integration           | Platform-owned serialized merge queue                    |
| Telemetry             | OpenTelemetry                                            |
| Configuration         | YAML repository manifest plus database overrides         |
| Secrets               | Encrypted local store with external-provider abstraction |
| Linux service         | `systemd`                                                |
| macOS service         | `launchd`                                                |
| Primary packaging     | `bun build --compile` signed native binaries             |
| Convenience packaging | Minimal `npx` bootstrapper                               |
| Remote exposure       | HTTPS reverse proxy or secure tunnel                     |
| Authentication        | Local admin and scoped API tokens                        |
| Initial tenancy       | Single organization/instance                             |
| Initial scaling       | One server process and one active scheduler              |
| Engineering standards | TDD, strict TypeScript, zero compiler warnings           |

---

## 30. Final Architectural Position

The platform should be designed as a local-first agent operations control plane.

The executable contains:

* Scheduler
* API server
* CLI
* Embedded web UI
* Agent supervisor
* Git workspace manager
* Validation engine
* Integration queue
* Notification service
* Audit and telemetry pipeline

Agent CLIs remain separately installed executables invoked through versioned adapters.

Projects describe their desired automation in repository configuration, while the platform owns runtime state, secrets, execution history, security policy, and integration controls.

The critical architectural boundary is:

```text
Agent proposes and produces work.
The platform validates, governs, records, and integrates that work.
```

That boundary is what turns a collection of scheduled agent commands into a dependable software-delivery platform.
