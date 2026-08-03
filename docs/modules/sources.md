# Module: sources

**Path:** `src/sources/`

## Responsibility

Sources connect a project to authoritative external systems. A project may have
multiple repository, tracker, deployment, incident, or generic sources.
Storage, API, and UI depend on `SourceAdapter`, not provider names. (Source
adapters are unrelated to agent adapters — same word, different domain.)

The initial adapters are:

- GitHub repositories (pull requests and issues)
- GitLab repositories (merge requests and issues)
- Forgejo/Gitea repositories (pull requests and issues)
- signed generic work webhooks (tickets, incidents, deployments, documents, or
  other source-native kinds)

Adapters declare capabilities. Unsupported concepts remain absent: a tracker
ticket is not assigned fake mergeability and a deployment does not need review
state. Native state and JSON are retained beside normalized Work fields.

GitHub, GitLab, and Forgejo adapters also expose a narrow platform write
contract: comment, mutate labels, read diffs/checks, inspect label actors, and
merge a pull request. Agent processes never receive forge write credentials.
Only the source/control services resolve the connection token and execute these
mutations.

## Connection base URL

Repository identities are normalized from HTTPS or SSH remotes. The source
connection API base URL is derived from the remote host by default
(`https://api.github.com`, `https://<host>/api/v4` for GitLab,
`https://<host>` for Forgejo). Self-hosted forges that expose the API on a
different scheme or port override this with a project-level manifest field:

```yaml
source:
  apiUrl: http://192.168.5.251:3001
```

`ensureProjectRepositorySource` prefers `source.apiUrl` over the derived URL
and self-heals an existing connection for the same adapter + host when the
stored `base_url` differs, so a stale derived row does not spawn a duplicate.
Per-agent `integration.prApiUrl` remains the tea/PR CLI setting and does not
own the connection-level URL.

## Synchronization truth

Sync runs on a
one-minute repair loop independently of the scheduler lease. Active resources
are fetched with provider pagination. Successful observations remain current.
An active snapshot is authoritative only when pagination completes
(`backfillComplete: true`). Incomplete pages never mark unseen open work stale.

When a complete snapshot omits a previously open item, gojo verifies that item
individually through the adapter `getItem` capability when available. Confirmed
`merged` / `closed` results clear attention and move the item into History.
404s, permission failures, and other non-authoritative responses leave the item
stale and actionable instead of inventing a terminal delivery. A failed refresh
marks the source's active items as sync errors, so last-known state remains
visible without being reported as verified. Errors back off and remain visible.

Webhooks provide fast updates; polling repairs missed delivery. Generic webhook
events require an HMAC-SHA256 signature, durable delivery ID, and event time.
Duplicate deliveries are ignored and older observations cannot overwrite newer
state.

Credentials resolve from a connection's secret reference, with conventional
provider environment variables as a compatibility fallback. GitHub also reuses
the active `gh` CLI login when no explicit token is configured. Secrets are
never stored in `project_sources` or native work metadata.

`GOJO_SOURCE_TOKEN=… gojo source token set <source-id> [--secret-name <name>]`
stores or rotates the secret (or prompts on a TTY) and persists only its
reference on the connection. `gojo server doctor` reports missing source write
credentials. For pull requests, source sync also
polls comments from trusted issue-label actors and converts exact
`/gojo approve|merge|hold|reject` commands into idempotent control intents.

## Provenance

Adapters map forge author type to `human` or `bot`. Pull/merge requests whose
head branch starts with `gojo/` are classified as `gojo-agent` even when opened
through a human CLI login. Source sync must not downgrade an existing
`gojo-agent` ledger row to `human`/`bot`/`external`.

## APIs and CLI

- `GET /api/v1/projects/:id/sources`
- `POST /api/v1/projects/:id/sources/:sourceId/refresh`
- `POST /api/v1/work/:id/recheck`
- `POST /api/v1/sources/:sourceId/events`
- `gojo project sources|refresh-source|recheck-work|resolve-work`

Connector health, observation time, errors, cursor state, and backfill
completeness are operator visible.
