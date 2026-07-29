---
name: gojo-web-ui
description: >-
  Vue ops UI conventions for web/: AppButton variants and loading, Lucide icons,
  StatusBadge/status-icons for enums, custom CSS tokens (not shadcn/Tailwind).
  Use when editing web/src views or components, adding buttons/badges/icons,
  or changing command-center / table chrome.
---

# gojo web UI

Ops UI under `web/` is Vue 3 + Vue Router + Vite + custom CSS in
`web/src/styles.css`. Icons are **lucide-vue-next** via `UiIcon`. Do not add
shadcn, Tailwind, Phosphor, or Heroicons for this app.

## Stack

| Piece | Location |
|-------|----------|
| Views | `web/src/views/` |
| Shared components | `web/src/components/` |
| Status badges | `web/src/components/status/` |
| Status maps | `web/src/lib/status-icons.ts` |
| Display helpers | `web/src/lib/work-display.ts`, `work-attention.ts` |
| Tokens / chrome | `web/src/styles.css` (`.btn*`, `.badge*`) |
| Alias | `@/*` → `web/src/*` (see `web/tsconfig.app.json`) |

Finish UI changes with `cd web && bun run typecheck && bun run test`, and
`make check` before PR.

## Buttons — always `AppButton`

Use [`web/src/components/AppButton.vue`](web/src/components/AppButton.vue). Do
**not** hand-roll `<button class="btn …">` for product actions.

```vue
<AppButton
  variant="primary"
  size="sm"
  :icon="RefreshCw"
  :loading="busy"
  loading-label="Syncing…"
  @click="runSync()"
>
  Sync
</AppButton>
```

### Variants

| Variant | Use for |
|---------|---------|
| `primary` | One main forward CTA on a surface (sync, save, enqueue, approve, create, run) |
| `secondary` (default) | Cancel, refresh, browse, enable/disable, test, nav chips, “Open in source” |
| `danger` | Irreversible / harmful (remove, revoke, cancel run, reject, delete) |
| `ghost` | Low-emphasis chrome; use `:selected` for toggles — **not** `primary` for “active” |

Sizes: `sm` in headers/tables/toolbars; `md` (default) in dialogs/forms.

### Icons + loading

- Every action button gets a leading Lucide icon (`:icon="…"`).
- Async / long-running actions set `:loading` and a short `loading-label`
  (`Syncing…`, `Enqueueing…`, `Saving…`, `Working…`). Loading swaps in a spinner,
  sets `aria-busy`, and disables the control.
- Links: pass `to` (RouterLink) or `href` (+ `target` as needed). Same variants.
- Confirm dialogs: [`ConfirmDialog.vue`](web/src/components/ConfirmDialog.vue)
  supports `:busy` / `busy-label` — wire parent busy refs so confirms cannot
  double-submit.
- Row overflow menus: [`ActionMenu.vue`](web/src/components/ActionMenu.vue)
  (⋯ via Lucide). Prefer menus for secondary row actions; keep one primary CTA
  in the cell when needed.

### Do not

- Use `btn-primary` to mean “selected toggle” — use `variant="ghost" :selected`
- Leave async buttons with only `:disabled` and an unchanged label
- Mix filled custom button CSS outside `AppButton` / `.btn*` tokens

## Status / enums — badges, not raw strings

Domain enums (work kind, result, execution, delivery, attention, sync, run
state, verification, enabled, provenance, channel type, health) render through
status components, not bare uppercase text.

| Need | Component / helper |
|------|-------------------|
| Kind (Run / PR / …) | `WorkKindBadge` |
| Result / outcome | `WorkResultBadge` |
| Execution phase | `ExecutionBadge` |
| Delivery | `DeliveryBadge` |
| Attention reason | `AttentionBadge` |
| Sync freshness | `SyncStateBadge` |
| Run state | `StateBadge` |
| Verification / integration | `VerificationBadge`, `IntegrationStatusBadge` |
| Enabled | `EnabledBadge` |
| Provenance | `ProvenanceBadge` |
| Health / paused chip | `HealthBadge`, or `StatusBadge` + `pausedStatus()` |

Maps live in [`web/src/lib/status-icons.ts`](web/src/lib/status-icons.ts)
(`{ icon, tone, label }`). Extend the map when adding an enum value; add a unit
case in `tests/unit/web/status-icons.test.ts`.

### Display rules

- Dense tables: icon-primary (`showLabel=false` default on kind/result/etc.);
  `aria-label` / `title` carry the full text.
- Chips / headers: icon + short label (`showLabel` true) where space already
  shows a badge.
- Tones reuse `.badge-*` (`success`, `failed`, `warn`, `running`, `queued`,
  `neutral`) — do not invent parallel color classes.

Primitive: [`StatusBadge.vue`](web/src/components/StatusBadge.vue) +
[`UiIcon.vue`](web/src/components/UiIcon.vue).

## Layout / chrome patterns

- **panel** — mixed chrome (stats, filters, primary actions) optionally plus a table
- **list-section** — list-only: title + one table
- Prefer existing table/pager/action-menu patterns over one-off toolbars
- AppShell nav may keep path SVGs; new product icons should be Lucide

## Metric tiles

Use [`StatGrid.vue`](web/src/components/StatGrid.vue) + [`StatTile.vue`](web/src/components/StatTile.vue)
with keys from [`web/src/lib/stat-metrics.ts`](web/src/lib/stat-metrics.ts). Do **not** hand-roll
`.stat` / `.stats-row` markup for product metrics.

- Layout: header row is icon (left) + title (right), count underneath, trend at the bottom.
- `metricKey` selects icon, tone, trend, and direction from `METRICS`.
- Pass numeric `value` + optional `previous` for deltas; `compareLabel` from `compareLabel()`.
- `to` / `href` for linked tiles; attention metrics show a flag dot when value &gt; 0.
- Impact categories use `impact.category.<category>` keys (labels + icons live only in
  `stat-metrics`; `impactCategoryLabel` / `impactCategorySpec` read from that catalog).
  Dashboard/project strips render `categoryTotals` as `StatTile`s — distinct-run counts,
  no verification breakdown on the tile.
- Extend `METRICS` and add cases in `tests/unit/web/stat-metrics.test.ts` when adding keys.

## Out of scope for this skill

- Marketing brand voice / CIP → `brand` skill
- Astro docs site → `gojo-astro-site`
- Daemon `src/` behavior → `gojo-tdd-daemon` + module docs

## Checklist before done

- [ ] Actions use `AppButton` with icon + correct variant
- [ ] Long-running actions have `:loading` + `loading-label`
- [ ] Enums use status badges / `status-icons` maps
- [ ] Inventory/impact metrics use StatGrid + StatTile / `stat-metrics`
- [ ] No new Tailwind/shadcn/alternate icon library
- [ ] `web` typecheck + tests green; `make check` before PR
