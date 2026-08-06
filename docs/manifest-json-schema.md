# `gojo.yaml` JSON Schema (editor support)

Editors that speak the [YAML Language Server](https://github.com/redhat-developer/yaml-language-server)
(Red Hat YAML in VS Code/Cursor) can autocomplete and validate project manifests
when they are associated with our generated JSON Schema.

## Source of truth

| Layer | Role |
|-------|------|
| [`packages/contracts/src/manifest.ts`](../packages/contracts/src/manifest.ts) `ProjectManifestSchema` | Runtime Zod validation (Sync, CLI, API) |
| [`packages/contracts/schemas/gojo.project.schema.json`](../packages/contracts/schemas/gojo.project.schema.json) | Generated draft-07 JSON Schema for editors |
| [`site/public/schemas/gojo.project.schema.json`](../site/public/schemas/gojo.project.schema.json) | Same bytes, served on GitHub Pages |

Regenerate both copies after changing the Zod schema:

```bash
bun run generate:manifest-schema
```

`make check` / `scripts/ci-check.sh` runs the generator with `--check` so the
committed artifacts cannot drift.

JSON Schema does **not** encode Zod `.superRefine` cross-field rules (for
example `prAutoMerge` only with `integration.mode: pull-request`). Sync remains
authoritative.

## Hosted URL (Option 2)

Stable public URL after the docs site deploys:

`https://detroitpro.github.io/gojo/schemas/gojo.project.schema.json`

Schema Store catalog registration should point at that URL with
`fileMatch` patterns `gojo.yaml` and `**/.gojo/project.yaml` (see
[`packages/contracts/schemas/schemastore-catalog-entry.json`](../packages/contracts/schemas/schemastore-catalog-entry.json)).

## Associating the schema in an editor (Option 1)

### Modeline (portable)

Add as the first line of `gojo.yaml`:

```yaml
# yaml-language-server: $schema=https://detroitpro.github.io/gojo/schemas/gojo.project.schema.json
version: 1
```

### Workspace settings

With the Red Hat YAML extension (or compatible client):

```json
{
  "yaml.schemas": {
    "https://detroitpro.github.io/gojo/schemas/gojo.project.schema.json": [
      "gojo.yaml",
      ".gojo/project.yaml"
    ]
  }
}
```

This repository’s [`.vscode/settings.json`](../.vscode/settings.json) maps the
local generated file for dogfood editing without network access.
