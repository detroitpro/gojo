# Module: network

**Paths:** `src/config/instance.ts`, `src/api/network.ts`, `src/api/server.ts`, CLI `instance`

## Responsibility

Deliberate remote exposure of the gojo HTTP API and ops UI. TLS is terminated at
Cloudflare (or another reverse proxy). Gojo itself listens with plain HTTP on
`bindHost:bindPort`. Secure cookies and visitor IPs come from trusted
`X-Forwarded-*` headers.

See PRD §19.4–19.5 and §25.14.

## Contract (`instance.yaml`)

| Field | Purpose |
|-------|---------|
| `bindHost` / `bindPort` | Listen address (default `127.0.0.1:7430`) |
| `publicBaseUrl` | Canonical URL for UI and CSRF/CORS default origin. Agent `GOJO_API_URL` is `resolveApiBaseUrl` → `${publicBaseUrl}/api/v1` (loopback binds fall back to `http://127.0.0.1:${bindPort}/api/v1`). **Required when bind is non-loopback.** |
| `trustedProxies` | CIDRs/IPs (or token `cloudflare`) allowed to set `X-Forwarded-For` / `X-Forwarded-Proto` |
| `allowedOrigins` | CORS + CSRF Origin allowlist (empty = origin of `publicBaseUrl`) |
| `ipAllowlist` | Optional client IP allowlist after proxy resolution (empty = any) |
| `cookieSecure` | `auto` (default) / `always` / `never` |

There are **no** in-process TLS / cert fields.

### Start gates

If `bindHost` is not loopback and (`countUsers() === 0` or `publicBaseUrl` missing),
`startServer` refuses to listen with a next-step message. Run `gojo setup` on
loopback first, then set `publicBaseUrl` and reopen the bind.

### Agent callback URL

`resolveApiBaseUrl` prefers `${publicBaseUrl}/api/v1`. Loopback binds fall back to
`http://127.0.0.1:${bindPort}/api/v1`. Never advertise `http://0.0.0.0:…`.

## Edge hardening (`src/api/network.ts`)

1. Peer IP from Bun `requestIP`; if peer ∈ expanded `trustedProxies`, honor forwarded headers.
2. IP allowlist → 403 (except `GET /api/v1/health`).
3. Login/setup sliding-window rate limit per client IP → `429 rate_limited`.
4. `cookieSecure: auto` sets `Secure` when resolved proto is `https`.
5. Cookie-authenticated mutations require Origin/Referer in the allowlist; Bearer exempt. WebSocket RPC replays the browser Origin captured at upgrade.
6. CORS only for allowed origins (credentials, no `*`).

## Operator surfaces

| Surface | Behavior |
|---------|----------|
| `GET/PATCH /api/v1/instance` | Network fields; PATCH may return `restartRequired: true` |
| `gojo instance show` / `set` | Read/write `instance.yaml`; restart guidance |
| Settings → Network | Same fields + Cloudflare preset |
| `gojo server doctor` | `network` block + warnings (https without trusted proxies, LAN cleartext, unresolved apiBaseUrl) |

## Recipes

### Cloudflare Tunnel

1. Setup + login on `127.0.0.1`.
2. `gojo instance set --public-base-url https://gojo.example.com --trusted-proxies cloudflare,127.0.0.1`
3. Point the tunnel at `http://127.0.0.1:7430`.
4. `gojo service restart`.

### Proxied DNS (orange cloud)

Same `publicBaseUrl` https hostname; `trustedProxies` must include `cloudflare`
(or explicit CF CIDRs). Origin pull hits your LAN/VPS bind — keep gojo on a
private address when possible.

### LAN-only (no Cloudflare)

```bash
gojo instance set --bind-host 0.0.0.0 --public-base-url http://192.168.4.73:7430
gojo service restart
```

Doctor warns about cleartext. Prefer VPN or Cloudflare for anything beyond a
trusted LAN.

## Related

- [auth](./auth.md) — sessions, cookies, password change
- Site: [Settings](../../site/src/pages/settings.md), [FAQ](../../site/src/pages/faq.md), [Getting started](../../site/src/pages/getting-started.md)
