# gojo engineering docs

Maintainer- and agent-oriented documentation for this repository.

| Location | Purpose |
|----------|---------|
| [`site/`](../site/) | **User** docs (install, first agent, settings) — published to GitHub Pages |
| [`docs/`](./) | **Engineering** docs (boundaries, modules, living notes) |
| [`PRD.md`](../PRD.md) | Product and architecture **source of truth** |

Do **not** maintain a separate ADR log. Put engineering notes on the relevant architecture or module page and keep them current (see project skill `gojo-docs-hygiene`).

## Index

- [Architecture overview](./architecture/overview.md)
- [Module boundaries](./architecture/boundaries.md)
- [Agent prompts](./agent-prompts.md) — constrained limits for `.gojo/agents/`
- [Repository files](./repo-files.md) — which `.gojo/` files are committed vs generated
- Modules:
  - [runs](./modules/runs.md) (includes self-healing plumbing)
  - [work](./modules/work.md) (cross-source project visibility)
  - [sources](./modules/sources.md) (GitHub/GitLab/Forgejo/non-git connectors)
  - [platform events](./modules/events.md) (durable invalidation over WebSocket + live UI refresh)
  - [notifications](./modules/notifications.md) (channels, per-agent routing, report delivery)
  - [adapters](./modules/agents.md) (adapter registry — file kept at `modules/agents.md`)
  - [scheduler](./modules/scheduler.md)

User-facing guides (site):

- Self-healing: [`site/src/pages/self-healing.md`](../site/src/pages/self-healing.md)
- Agent prompt best practices: [`site/src/pages/agent-prompts.md`](../site/src/pages/agent-prompts.md)

## Quality gate

Before opening or pushing a PR:

```bash
make check
```

Same script as GitHub Actions CI (`.github/workflows/ci.yml` → `scripts/ci-check.sh`).
