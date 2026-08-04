# @gojo/contracts

Shared wire contracts for the gojo daemon, CLI, and admin UI.

## Entry points

| Import | Contents |
|--------|----------|
| `@gojo/contracts` / `@shared/*` | Zod schemas + pure helpers (daemon/CLI) |
| `@gojo/contracts/schemas` | Same as above (explicit) |
| `@gojo/contracts/types` | Type-only exports safe for the Vite bundle |

Do not import `@gojo/contracts/schemas` from `web/` — it pulls Zod into the browser bundle.
Prefer `@gojo/contracts/types` (or the browser wire mirror in `web/src/lib/ws-types.ts` when zero shared runtime is required).
