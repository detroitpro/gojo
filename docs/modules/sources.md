# Module: sources

**Path:** `src/sources/`

## Responsibility

Sources connect a project to authoritative external systems. A project may have
multiple repository, tracker, deployment, incident, or generic sources.
Storage, API, and UI depend on `SourceAdapter`, not provider names.

The initial adapters are:

- GitHub repositories (pull requests and issues)
- GitLab repositories (merge requests and issues)
- Forgejo/Gitea repositories (pull requests and issues)
- signed generic work webhooks (tickets, incidents, deployments, documents, or
  other source-native kinds)

Adapters declare capabilities. Unsupported concepts remain absent: a tracker
ticket is not assigned fake mergeability and a deployment does not need review
state. Native state and JSON are retained beside normalized Work fields.

## Synchronization truth

Repository identities are normalized from HTTPS or SSH remotes. Sync runs on a
one-minute repair loop independently of the scheduler lease. Active resources
are fetched with provider pagination. Successful observations remain current;
an active item absent from a complete active snapshot becomes stale immediately
and drops out of verified-open counts. A failed refresh marks the source's
active items as sync errors, so last-known state remains visible without being
reported as verified. Errors back off and remain visible.

Webhooks provide fast updates; polling repairs missed delivery. Generic webhook
events require an HMAC-SHA256 signature, durable delivery ID, and event time.
Duplicate deliveries are ignored and older observations cannot overwrite newer
state.

Credentials resolve from a connection's secret reference, with conventional
provider environment variables as a compatibility fallback. GitHub also reuses
the active `gh` CLI login when no explicit token is configured. Secrets are
never stored in `project_sources` or native work metadata.

## APIs and CLI

- `GET /api/v1/projects/:id/sources`
- `POST /api/v1/projects/:id/sources/:sourceId/refresh`
- `POST /api/v1/sources/:sourceId/events`
- `gojo project sources|refresh-source`

Connector health, observation time, errors, and cursor state are operator
visible.
