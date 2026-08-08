# @gojo/contracts

Shared wire contracts for the gojo daemon, CLI, and admin UI.

## Entry points

| Import | Contents |
|--------|----------|
| `@gojo/contracts` / `@shared/*` | Zod schemas + pure helpers (daemon/CLI) |
| `@gojo/contracts/schemas` | Same as above (explicit) |
| `@gojo/contracts/types` | Type-only exports safe for the Vite bundle |

Do not import `@gojo/contracts/schemas` from `web/` — it pulls Zod into the browser bundle.
Prefer `@gojo/contracts/types` (or `packages/contracts/src/ws.ts` when zero shared runtime is required).

## `gojo.yaml` JSON Schema

[`schemas/gojo.project.schema.json`](./schemas/gojo.project.schema.json) is
**generated** from `ProjectManifestSchema` for editor autocomplete (YAML Language
Server). Do not hand-edit it.

```bash
bun run generate:manifest-schema
```

See [`docs/manifest-json-schema.md`](../../docs/manifest-json-schema.md).
