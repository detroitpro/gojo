---
name: gojo-docs-hygiene
description: >-
  Keeps living engineering documentation under docs/ accurate when code or
  boundaries change. Use when changing module contracts, architecture, public
  CLI/API behavior, or when the user mentions docs hygiene, docs/, or
  maintainer documentation. Do not create ADR logs.
---

# gojo docs hygiene

## Split of docs

| Location | Audience |
|----------|----------|
| `site/` | End users (install, first agent, settings) |
| `docs/` | Maintainers & agents (boundaries, modules) |
| `PRD.md` | Product/architecture source of truth |

## Instructions

1. If a change alters behavior, ownership, or allowed dependencies, **update the relevant `docs/` page in the same change**.
2. Prefer updating **living** pages (`docs/architecture/*`, `docs/modules/*`) over creating decision-log files.
3. **Do not** create `docs/adr/` or ADR numbering. Engineering choices that aren’t in the PRD go inline on the module/architecture page.
4. **Link** `PRD.md` sections for product policy; don’t restate long PRD essays.
5. Keep `docs/README.md` index accurate when adding/removing pages.
6. User-facing install/CLI changes also update `site/` (and README when appropriate).

## When unsure

- New module boundary → `docs/architecture/boundaries.md` + a `docs/modules/<name>.md` stub
- Scheduler/run/adapter/agent ownership → existing module pages + PRD §§9–14, 23

## Vocabulary anchors

The Tasks→Agents rebrand renamed the top-level UI/CLI and manifest keys. When
writing or reviewing docs:

- **Adapter** — installed coding-agent CLI. UI/CLI: `Adapters` / `gojo adapter …`.
- **Profile** — `profiles:` map entry binding an adapter to a model/timeout.
- **Agent** — `agents:` map entry: the work-unit definition. UI/CLI: `Agents` / `gojo agent …`.
- Prompt files live under `.gojo/agents/`.
- User-facing docs page: `site/src/pages/agent-prompts.md` (URL `/agent-prompts`).
- Engineering note: `docs/agent-prompts.md`.

Do not reintroduce the old vocabulary (`task`, `.gojo/tasks/`, `gojo task`,
`agents:` as the adapter map) in living docs.
