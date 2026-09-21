---
name: gojo-web-ui
description: >-
  React + Atlaskit ops UI conventions for web/: AppButton variants and loading,
  StatusBadge/lozenges via status-icons, ADS light/dark tokens (not shadcn/Tailwind).
  Use when editing web/src views or components, adding buttons/badges/icons,
  or changing command-center / table chrome.
---

# gojo web UI

Ops UI under `web/` is React 18 + react-router-dom + Zustand + Vite + Atlaskit,
with shared CSS in `web/src/ui/styles.css` and theme tokens from `theme/tokens.css`
(ADS light + dark maps; Atlaskit `--ds-*` surfaces bridged onto the same ramp).
Prefer `@atlaskit/*` components via thin wrappers in `ui/`. Icons may
use `lucide-react` or `@atlaskit/icon` when an Atlaskit glyph exists. Do not add
shadcn, Tailwind, Phosphor, or Heroicons for this app.

Layout follows `web/src/README.md` (kernel / contexts / platform / infrastructure / ui).
Context views bind live refresh through Zustand stores — see `useBindStoreRefresh`
and `LiveStoreBridge.tsx`; do not add per-view `useLiveRefresh` in contexts.

## Stack

| Piece | Location |
|-------|----------|
| Views | `web/src/contexts/<bc>/views/` |
| Context components | `web/src/contexts/<bc>/components/` |
| Shared components | `web/src/ui/` |
| Status badges | `web/src/ui/status/` |
| Status maps | `web/src/kernel/status-icons.ts` |
| Display helpers | `web/src/kernel/work-display.ts`, `work-attention.ts` |
| Tokens / chrome | `theme/tokens.css`, `web/src/ui/styles.css` |
| Hooks | `web/src/platform/useLiveQuery.ts`, `bind-store-refresh.ts`, etc. |
| Zustand stores | `web/src/contexts/<bc>/store.ts` (export via `contract.ts`) |
| API / types | `web/src/contexts/<bc>/contract.ts` |
| Alias | `@/*` → `web/src/*` (see `web/tsconfig.app.json`) |

Finish UI changes with `cd web && bun run typecheck && bun run test`, and
`make check` before PR.

## Buttons — always `AppButton`

Use [`web/src/ui/AppButton.tsx`](web/src/ui/AppButton.tsx). Do
**not** hand-roll raw Atlaskit `Button` for product actions unless extending the wrapper.

```tsx
<AppButton
  variant="primary"
  loading={busy}
  loadingLabel="Syncing…"
  onClick={() => void runSync()}
>
  Sync
</AppButton>
```

### Variants

| Variant | Use for |
|---------|---------|
| `primary` | One main forward CTA on a surface (sync, save, enqueue, approve, create, run) |
| `secondary` (default) | Cancel, refresh, browse, enable/disable, test, nav chips |
| `danger` | Irreversible / harmful (remove, revoke, cancel run, reject, delete) |
| `ghost` | Low-emphasis chrome; use `selected` for toggles — **not** `primary` for “active” |

Sizes: default `md` uses ADS Button `spacing="default"` (**32px**). Use
`size="sm"` (ADS compact, 24px) only in dense tables, pagers, and inline row
actions. Do **not** stretch buttons to field default height — pair them with
compact fields instead (see below).

### Icons + loading

- Prefer a leading icon via `iconBefore` (IconProp / component factory for Atlaskit).
- Async actions set `loading` and a short `loadingLabel`.
- Links: pass `to` (react-router) or `href`. Same variants.
- Confirm dialogs: [`ConfirmDialog.tsx`](web/src/ui/ConfirmDialog.tsx) with `busy`.
- Row overflow menus: [`ActionMenu.tsx`](web/src/ui/ActionMenu.tsx).
- Selects: always [`AppSelect.tsx`](web/src/ui/AppSelect.tsx) (portals the menu to
  `document.body`; defaults `spacing="compact"` for 32px). Do not import
  `@atlaskit/select` directly in views.
- Text fields: always [`AppTextfield.tsx`](web/src/ui/AppTextfield.tsx) (defaults
  `isCompact`). Do not import `@atlaskit/textfield` directly in views.
- Exclusive toggle groups (status filters, sort chips): use
  [`SegmentedControl.tsx`](web/src/ui/SegmentedControl.tsx) — bordered 32px
  segments — not a row of ghost `AppButton`s.

## Status — always `StatusBadge` / domain badges

Domain enums map through `web/src/kernel/status-icons.ts` (`tone` + `label` +
`toneIcon`) and render via `StatusBadge` or `ui/status/*Badge.tsx`.

`StatusBadge` is deliberately **not** `@atlaskit/lozenge`: the legacy lozenge
hardcodes theme-blind fills (e.g. success `#b3df72`), and the newer lozenge ties
icon color to the pill tint. Gojo badges are a **neutral pill** (`.badge-neutral`)
with a **tone-colored lucide icon** only — green success, amber/orange queued
(PR open), red failed, blue running. Do not reintroduce Atlaskit Lozenge for
status chrome.

## Live data

```ts
useBindStoreRefresh(useCatalogStore.getState(), load);
```

Views wrap loaders in `useCallback` and pass them to `useBindStoreRefresh`.
The hook binds via a **ref** so an unstable `refresh` identity does not re-hydrate
every render (that loop floods the network). Prefer depending on `soft.run`
(not the whole `useSoftLoading` return) inside loader `useCallback` deps.

## Theme

Shared ADS-aligned tokens in `theme/tokens.css`: light on `:root`, dark under
`html[data-color-mode="dark"]` (Atlaskit resolves preference `auto` to a concrete
`light`/`dark` attribute — there is no `data-color-mode="auto"` CSS branch).
`:root[data-color-mode][data-theme~=…]` blocks bridge Atlaskit `--ds-surface*`,
`--ds-text*`, `--ds-border*`, and `--ds-background-input` onto the gojo ramp so
Select/Modal/Textfield share the same blue-black (dark) / ink (light) surfaces.
Admin mounts `@atlaskit/css-reset` and `AppProvider` with `defaultColorMode` from
`localStorage` key `gojo.colorMode` (`light` | `dark` | `auto`; default `light`).
Shell toggle: [`ColorModeMenu`](web/src/ui/ColorModeMenu.tsx) via `useSetColorMode`.
Prefer CSS vars (`--bg`, `--text`, `--accent`, status tokens) over hard-coded hex
so both modes stay coherent. Do not reintroduce the old dark “Six Eyes” palette.
