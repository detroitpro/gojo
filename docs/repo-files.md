# Repository files: registration vs generated

A gojo-managed repository contains two kinds of gojo files, and they have
opposite version-control rules. The contract lives in one place —
[`packages/contracts/src/workspace-files.ts`](../packages/contracts/src/workspace-files.ts) — and is
consumed by the integrator, the coordinator, and `project doctor`.

## Registration files — commit these

Human-authored configuration. A checkout should fully describe its agents, so
these belong in git.

| Path | Purpose |
|------|---------|
| `gojo.yaml` (or legacy `.gojo/project.yaml`) | Manifest: `profiles:`, `agents:`, schedules |
| `.gojo/agents/**` | Agent prompt files and prompt scripts |
| `.gojo/instructions.md` | Shared instructions prepended for every agent |
| `.gojo/labels.md` | Label taxonomy for issue/PR agents |

`REGISTRATION_PATHS` enumerates these. `project doctor` reports any that exist
on disk but are untracked, which usually means a manifest change was never
committed and `project sync` is reading files the remote does not have.

## Generated files — never commit these

Per-run scratch that gojo writes into the worktree. Each is persisted properly
as a run artifact under `~/.gojo/artifacts/<runId>/`, so the copy in the
worktree is disposable.

| Path | Written by |
|------|-----------|
| `.gojo/handoff.json` | The agent, per the handoff contract; read back by `readHandoffIfPresent` |
| `.gojo/run.sh` | The shell adapter, materialized from the agent prompt |
| `.gojo/assets/` | The agent, for long PR bodies and reports; copied to `artifacts/<runId>/assets/` |
| `.gojo/context/subject.json` | The platform, for issue- or PR-triggered runs — an immutable snapshot of the untrusted source subject (labels, title, body); excluded from commits |

`GENERATED_WORKSPACE_PATHS` enumerates these; directory entries end with `/`.

### Why committing them breaks merges

Every agent branch writes the *same* path. If that path is tracked, each merge
into the base branch rewrites it, which makes every other open pull request
conflict on a file that has nothing to do with the change. A repository
producing five agent PRs a day accumulates unmergeable PRs faster than a merge
agent can drain them, and the oldest ones starve.

A second failure mode: a run that changes no product code still leaves a
modified `handoff.json`. That makes the worktree look dirty, so
"no diff means no pull request" cannot fire and the run opens an empty PR that
nothing will ever merge.

## How the platform enforces it

`integrate()` excludes `GENERATED_WORKSPACE_PATHS` from the dirty check, the
result commit, and `filesChanged`, using the shared `PathspecOptions` on
`statusPorcelain` / `diffNameOnly` / `commitAll`. This holds regardless of a
repository's `.gitignore`, so onboarding a repo that forgot the ignore rules
cannot poison its own pull requests.

`.gitignore` remains the belt-and-braces layer: it keeps the files out of a
developer's own `git status` and out of manual commits. `project doctor`
reports drift and emits the canonical block from `gojoGitignoreBlock()`:

```gitignore
# gojo: ignore generated run files, keep registration files
.gojo/*
!.gojo/agents/
!.gojo/agents/**
!.gojo/instructions.md
!.gojo/labels.md
```

Deny-then-re-include is deliberate: new generated files are ignored by default,
so adding one to the platform does not require editing every repository.

## Checking a project

```bash
gojo project doctor <project-id>
```

`workspaceFiles` reports `trackedGeneratedFiles`, `unignoredGeneratedFiles`,
`untrackedRegistrationFiles`, and a `suggestedGitignore` block when anything
needs fixing. The same data drives the Health panel on the project detail page.

To repair a repository that already committed a generated file:

```bash
git rm --cached .gojo/handoff.json
# add the block above to .gitignore, then commit
```
