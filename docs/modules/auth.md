# Module: auth

**Paths:** `src/contexts/access/domain/users.ts`, `src/contexts/access/infrastructure/auth/`, `src/transports/http/auth.ts`, CLI `setup` / `auth`, `src/contexts/access/` (bounded context)

> The **access** bounded context (`src/contexts/access/`) owns the JSON-facing
> subset of this module. `GET /api/v1/auth/me` and `GET/POST/DELETE
> /api/v1/auth/tokens[/{id}]` are served by registered use cases
> (`access.me.get`, `access.tokens.list`, `access.tokens.create`,
> `access.tokens.revoke`). Login, logout, setup, password change, and approval
> link routes stay in `src/transports/http/router.ts` because they need `Set-Cookie` / HTML
> transport. User/token records live in `domain/users.ts`; `infrastructure/auth/` implements
> `UserServicePort` (the old top-level `src/auth/` shim was retired as R18 in
> [`removal-backlog.md`](../architecture/removal-backlog.md)).

## Responsibility

Local administrator identity for the ops API and web UI. gojo is a single-admin
product today: one first-run user, session cookies for the browser, and Bearer
API tokens for automation. Schema roles (`admin` / `operator` / `viewer`) exist
for a future multi-user release; only `admin` is created by setup.

## Create-once setup

`gojo setup` and `POST /api/v1/setup` create the first row in `users` when the
table is empty. If any user already exists, both refuse with a conflict error.
Setup never overwrites a password and never creates a second user.

To change credentials after setup:

| Surface | Command / route |
|---------|-----------------|
| CLI (local DB; daemon optional) | `gojo auth password` |
| API | `POST /api/v1/auth/password` |
| UI | Settings → Account |

## Credentials

| Kind | Storage | Notes |
|------|---------|-------|
| Password | `users.password_hash` (bcrypt) | Min 8 characters |
| Session cookie | HMAC-signed `gojo_session` | 7-day TTL; includes `issuedAt` |
| API token | `api_tokens.token_hash` (SHA-256 of `gojo_…`) | Optional scopes; not revoked by password change |

`password_updated_at` is bumped on every password change. Session verify rejects
cookies whose `issuedAt` is earlier than that timestamp, so other browsers must
sign in again. API tokens intentionally remain valid — they are a separate
credential.

## API surface

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/v1/setup` | Public only when no users | Create first admin |
| `POST /api/v1/auth/login` | Public | Set session cookie |
| `POST /api/v1/auth/logout` | Public | Clear cookie |
| `GET /api/v1/auth/me` | Required | Current user (`access.me.get` use case) |
| `POST /api/v1/auth/password` | Required | Change password |
| `GET/POST/DELETE /api/v1/auth/tokens…` | Required | Token CRUD (`access.tokens.*` use cases) |

Resolution order in [`src/transports/http/auth.ts`](../../src/transports/http/auth.ts): Bearer token,
then session cookie.

## Scoped bearer tokens

API tokens with **non-empty** `scopes` are restricted to explicit POST actions
(`scopedTokenAllows` in `auth.ts`). Unscoped tokens behave like full admin
credentials for HTTP (still subject to IP allowlist and CSRF rules on cookie
mutations).

| Scope | Allowed route |
|-------|----------------|
| `run:progress:{runId}` | `POST /api/v1/runs/{runId}/progress` |
| `run:approve:{runId}` | `POST /api/v1/runs/{runId}/approve` |
| `control:approve:{approvalId}` | `POST /api/v1/approvals/{approvalId}/approve` |

Scoped tokens are rejected at WebSocket upgrade (`isScopedAgentToken`). The HTML
approve-link flow (`GET|POST /api/v1/approvals/{id}/approve-link`) verifies
`control:approve:{id}` directly and revokes the token after a successful POST.

Run adapters receive short-lived `run:progress:{runId}` tokens as `GOJO_API_TOKEN`
(see [runs](./runs.md)). Approval-needed notifications mint 24-hour
`control:approve:{approvalId}` tokens for single-use operator links (see
[control](./control.md) and [notifications](./notifications.md)).

## CLI

```text
gojo setup                 # first admin only; interactive on TTY
gojo auth whoami           # list local users (no hashes)
gojo auth password         # change password against local SQLite
```

Human-facing failures include a next step (for example, setup-already-completed
points at `gojo auth password`).

## Remote exposure

Session cookies, CSRF, CORS, login rate limits, and Secure flags for proxied HTTPS
are owned by the [network](./network.md) module (`publicBaseUrl`, `trustedProxies`,
`cookieSecure`). Auth stays responsible for credential storage and token/session
verification.

## PRD

- [§19.4 Remote authentication](../../PRD.md#194-remote-authentication)
