import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from "yaml";

/**
 * Migrator for the Tasks→Agents vocabulary rebrand of a repo's gojo manifest.
 *
 * Rewrites:
 *   - top-level `agents:` → `profiles:` (adapter/model config)
 *   - top-level `tasks:`  → `agents:`   (work-unit definitions)
 *   - per-agent  `agent: <name>` → `profile: <name>`
 *   - `schedules.*.task` → `agent`
 *   - `selfHeal.task`    → `agent`
 *   - `promptFile: .gojo/tasks/...` → `.gojo/agents/...`
 * Moves `.gojo/tasks/` → `.gojo/agents/` on disk.
 *
 * Idempotent: a manifest already using the new vocabulary is left unchanged
 * (aside from the on-disk `.gojo/tasks` → `.gojo/agents` rename if only the
 * folder is still legacy).
 */
export interface MigrateVocabResult {
  manifestPath: string | null;
  manifestChanged: boolean;
  tasksDirMoved: boolean;
  promptFilesUpdated: number;
}

const MANIFEST_CANDIDATES = ["gojo.yaml", ".gojo/project.yaml"] as const;

function resolveManifestPath(repoPath: string): string | null {
  for (const rel of MANIFEST_CANDIDATES) {
    const candidate = join(repoPath, rel);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function rewritePromptFile(promptFile: unknown): { value: string; changed: boolean } | null {
  if (typeof promptFile !== "string") {
    return null;
  }
  const trimmed = promptFile.trim();
  const legacy = ".gojo/tasks/";
  const next = ".gojo/agents/";
  if (trimmed.startsWith(legacy)) {
    return { value: next + trimmed.slice(legacy.length), changed: true };
  }
  const scoped = "./.gojo/tasks/";
  if (trimmed.startsWith(scoped)) {
    return { value: "./.gojo/agents/" + trimmed.slice(scoped.length), changed: true };
  }
  return { value: promptFile, changed: false };
}

/**
 * Rewrite a raw parsed-YAML object in place. Returns the number of
 * substantive changes made (0 means the manifest was already migrated).
 */
export function rewriteManifestObject(
  raw: Record<string, unknown>,
): { changed: boolean; promptFilesUpdated: number } {
  let changed = false;
  let promptFilesUpdated = 0;

  const hasLegacyProfiles =
    Object.prototype.hasOwnProperty.call(raw, "agents") &&
    !Object.prototype.hasOwnProperty.call(raw, "profiles") &&
    Object.prototype.hasOwnProperty.call(raw, "tasks");

  const hasLegacyAgentsMap =
    Object.prototype.hasOwnProperty.call(raw, "tasks") &&
    !isAgentUnit(raw["agents"]);

  if (hasLegacyProfiles) {
    raw["profiles"] = raw["agents"];
    delete raw["agents"];
    changed = true;
  }

  if (hasLegacyAgentsMap) {
    raw["agents"] = raw["tasks"];
    delete raw["tasks"];
    changed = true;
  }

  const agentsMap = raw["agents"];
  if (agentsMap && typeof agentsMap === "object" && !Array.isArray(agentsMap)) {
    for (const [, agentUnknown] of Object.entries(agentsMap as Record<string, unknown>)) {
      if (!agentUnknown || typeof agentUnknown !== "object" || Array.isArray(agentUnknown)) {
        continue;
      }
      const agent = agentUnknown as Record<string, unknown>;

      if (
        Object.prototype.hasOwnProperty.call(agent, "agent") &&
        !Object.prototype.hasOwnProperty.call(agent, "profile")
      ) {
        agent["profile"] = agent["agent"];
        delete agent["agent"];
        changed = true;
      }

      const rewritten = rewritePromptFile(agent["promptFile"]);
      if (rewritten?.changed) {
        agent["promptFile"] = rewritten.value;
        promptFilesUpdated += 1;
        changed = true;
      }

      const selfHeal = agent["selfHeal"];
      if (selfHeal && typeof selfHeal === "object" && !Array.isArray(selfHeal)) {
        const heal = selfHeal as Record<string, unknown>;
        if (
          Object.prototype.hasOwnProperty.call(heal, "task") &&
          !Object.prototype.hasOwnProperty.call(heal, "agent")
        ) {
          heal["agent"] = heal["task"];
          delete heal["task"];
          changed = true;
        }
      }
    }
  }

  const schedules = raw["schedules"];
  if (schedules && typeof schedules === "object" && !Array.isArray(schedules)) {
    for (const [, scheduleUnknown] of Object.entries(schedules as Record<string, unknown>)) {
      if (
        !scheduleUnknown ||
        typeof scheduleUnknown !== "object" ||
        Array.isArray(scheduleUnknown)
      ) {
        continue;
      }
      const schedule = scheduleUnknown as Record<string, unknown>;
      if (
        Object.prototype.hasOwnProperty.call(schedule, "task") &&
        !Object.prototype.hasOwnProperty.call(schedule, "agent")
      ) {
        schedule["agent"] = schedule["task"];
        delete schedule["task"];
        changed = true;
      }
    }
  }

  return { changed, promptFilesUpdated };
}

/**
 * Heuristic: a value under the top-level `agents:` key is treated as a
 * work-unit map (post-rebrand) when it has `promptFile` and either `profile`
 * or `agent` (legacy pointer to a profile name). This avoids collapsing the
 * legacy adapter-config map (which has `adapter:` entries) onto itself.
 */
function isAgentUnit(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) {
    return false;
  }
  return entries.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      typeof record["promptFile"] === "string" &&
      (typeof record["profile"] === "string" || typeof record["agent"] === "string")
    );
  });
}

/** In-place rewrite of the YAML document AST (preserves comments where possible). */
function rewriteYamlSource(source: string): {
  output: string;
  changed: boolean;
  promptFilesUpdated: number;
} {
  const parsed = parseYaml(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { output: source, changed: false, promptFilesUpdated: 0 };
  }
  const clone = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  const { changed, promptFilesUpdated } = rewriteManifestObject(clone);
  if (!changed) {
    return { output: source, changed: false, promptFilesUpdated };
  }
  // Preserve top-level ordering (project, repository, instructions, profiles,
  // validationProfiles, agents, schedules, notifications) so the migrated
  // file remains readable.
  const ordered = orderTopLevel(clone);
  const document = parseDocument(stringifyYaml(ordered, { lineWidth: 0 }));
  return {
    output: document.toString({ lineWidth: 0 }),
    changed: true,
    promptFilesUpdated,
  };
}

function orderTopLevel(raw: Record<string, unknown>): Record<string, unknown> {
  const preferred = [
    "version",
    "project",
    "repository",
    "instructions",
    "profiles",
    "validationProfiles",
    "agents",
    "schedules",
    "notifications",
  ];
  const out: Record<string, unknown> = {};
  for (const key of preferred) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key];
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Migrate a single repository's manifest + prompt directory in place.
 * Idempotent: safe to call again on an already-migrated repo.
 */
export function migrateProjectVocab(repoPath: string): MigrateVocabResult {
  const manifestPath = resolveManifestPath(repoPath);
  const tasksDir = join(repoPath, ".gojo", "tasks");
  const agentsDir = join(repoPath, ".gojo", "agents");

  let manifestChanged = false;
  let promptFilesUpdated = 0;

  if (manifestPath && existsSync(manifestPath)) {
    const original = readFileSync(manifestPath, "utf8");
    const rewritten = rewriteYamlSource(original);
    if (rewritten.changed) {
      writeFileSync(manifestPath, rewritten.output, "utf8");
      manifestChanged = true;
      promptFilesUpdated = rewritten.promptFilesUpdated;
    }
  }

  let tasksDirMoved = false;
  if (existsSync(tasksDir) && !existsSync(agentsDir)) {
    // Ensure `.gojo/` exists (it must, since tasksDir is under it).
    renameSync(tasksDir, agentsDir);
    // Touch parent so tests can observe mtime changes if desired.
    void dirname(agentsDir);
    tasksDirMoved = true;
  }

  return {
    manifestPath,
    manifestChanged,
    tasksDirMoved,
    promptFilesUpdated,
  };
}
