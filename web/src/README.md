# `web/src/` — layout by bounded context

`web/src/` has exactly five top-level directories. Dependency direction is **down only**.

```text
web/src/
  kernel/            pure TS helpers (format, pagination, status-icons, work-*, run-*)
  contexts/          8 bounded contexts — API clients, types, stores, views
  platform/          app host: main, App, router, LiveStoreBridge, composables
  infrastructure/    HTTP transport, WebSocket client, platform-events, ApiError
  ui/                shared Vue chrome (AppButton, AppShell, badges, styles.css)
```

```text
platform ──► contexts ──► infrastructure ──► kernel
     │            │
     └──────► ui ──┘
```

Enforced by:

- `scripts/check-web-layout.sh` — no sixth top-level directory; only `env.d.ts` at root
- `.dependency-cruiser.cjs` — web layer + context boundary rules (wired into `make check`)

## Where does a new file go?

| If the change is… | Put it in… |
|-------------------|------------|
| A pure formatter/helper with no Vue or fetch | `kernel/` |
| API calls for one product capability | `contexts/<name>/api.ts` |
| UI-enriched DTOs for one capability | `contexts/<name>/types.ts` |
| Public exports other layers may import | `contexts/<name>/contract.ts` |
| Pinia store for one capability | `contexts/<name>/store.ts` |
| A route-level page | `contexts/<name>/views/` |
| Context-specific component | `contexts/<name>/components/` |
| Shared button, shell, table chrome | `ui/` |
| `fetch` / WS / `ApiError` | `infrastructure/` |
| Router, composables, app entry | `platform/` |

## Bounded contexts

| Context | Owns |
|---------|------|
| `access` | Login, session, API tokens, password |
| `catalog` | Projects, agents, schedules, adapters, impact |
| `scheduling` | Queue, scheduling policy, upcoming |
| `execution` | Runs, run detail, run events |
| `delivery` | Approvals, integrations |
| `work` | Work items, sources, recheck/resolve |
| `notifications` | Notification channels |
| `operations` | Dashboard, settings, doctor, backups, filesystem |

Cross-context imports **must** go through `contexts/<name>/contract.ts`.

## Import conventions

```ts
import { listProjects } from "@/contexts/catalog/contract";
import type { Project } from "@/contexts/catalog/types";
import { request } from "@/infrastructure/http";
import { fmtTime } from "@/kernel/format";
import AppButton from "@/ui/AppButton.vue";
import router from "@/platform/router";
```

## Pinia stores and live refresh

Each context has `store.ts` with `bindRefresh`, `unbindRefresh`, and `invalidate`.
Views register their load handlers on mount:

```ts
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import { useCatalogStore } from "@/contexts/catalog/contract";

const catalog = useCatalogStore();
bindStoreRefresh(catalog, load); // registers + hydrates once on mount
```

`platform/LiveStoreBridge.vue` owns one `platformEventHub` subscription and maps
each `PlatformEventTopic` to a non-overlapping set of store `invalidate()` calls
(coalesced). Views must not call `useLiveRefresh` directly.

Primary store exports (aliases kept for compat): `useCatalogStore`, `useOperationsStore`,
`useSchedulingStore`, `useExecutionStore`, `useDeliveryStore`, `useWorkStore`,
`useNotificationsStore`, `useAccessStore`.

## Tests

UI unit and smoke tests live under `web/tests/` (Vitest + `@vue/test-utils`).
Daemon-side web helper tests may remain under `tests/unit/web/` when they
exercise shared kernel helpers only.

## Related docs

- [Daemon `src/` layout](../../src/README.md)
- [Architecture overview](../../docs/architecture/overview.md)
- [Removal backlog](../../docs/architecture/removal-backlog.md)

## Packages vs `web/src/` layers

- **`packages/contracts`** — shared wire DTOs/schemas (daemon + web). Prefer contract types over duplicating DTOs in context `types.ts`.
- Context `types.ts` files hold **UI enrichments** (list row extras, composed shapes) re-exporting from `@gojo/contracts/types` where possible.
