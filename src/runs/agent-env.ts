import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { parse as parseDotenv } from 'dotenv';

import {
  AgentEnvironmentSchema,
  type AgentEnvironment,
} from '@shared/manifest';

export type LoadedAgentEnvironment = {
  values: Record<string, string>;
  /** Non-empty values selected for redaction in logs/artifacts. */
  secretValues: string[];
  config: AgentEnvironment;
};

/** Parse stored agent `environment_json` (config only; never resolved values). */
export function parseAgentEnvironmentConfig(
  environmentJson: string | null | undefined,
): AgentEnvironment | null {
  if (!environmentJson || environmentJson.trim() === '' || environmentJson.trim() === '{}') {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(environmentJson) as unknown;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length === 0) {
    return null;
  }
  const parsed = AgentEnvironmentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve a repo-relative dotenv path under the registered primary checkout.
 * Rejects absolute paths, `..` escapes, non-files, and symlinks that escape.
 */
export function resolveRepoEnvFilePath(repoPath: string, relativePath: string): string {
  const trimmed = relativePath.trim();
  if (!trimmed || isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new Error(`environment.file must be a repository-relative path: ${relativePath}`);
  }
  if (trimmed.split(/[\\/]/).includes('..')) {
    throw new Error(`environment.file escapes repository: ${relativePath}`);
  }

  const root = realpathSync(resolve(repoPath));
  const candidate = resolve(root, trimmed);
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`environment.file escapes repository: ${relativePath}`);
  }

  if (!existsSync(candidate)) {
    throw new Error(`environment.file not found: ${relativePath}`);
  }

  const linkStat = lstatSync(candidate);
  if (linkStat.isSymbolicLink()) {
    const real = realpathSync(candidate);
    const realRel = relative(root, real);
    if (realRel.startsWith('..') || realRel.split(sep).includes('..')) {
      throw new Error(`environment.file symlink escapes repository: ${relativePath}`);
    }
    if (!statSync(real).isFile()) {
      throw new Error(`environment.file is not a regular file: ${relativePath}`);
    }
    return real;
  }

  if (!linkStat.isFile()) {
    throw new Error(`environment.file is not a regular file: ${relativePath}`);
  }
  return candidate;
}

/** Load allowlisted variables from the primary-repo dotenv file. */
export function loadAgentEnvironment(input: {
  repoPath: string;
  environmentJson: string | null | undefined;
}): LoadedAgentEnvironment | null {
  const config = parseAgentEnvironmentConfig(input.environmentJson);
  if (!config) {
    return null;
  }

  const absolute = resolveRepoEnvFilePath(input.repoPath, config.file);
  const content = readFileSync(absolute, 'utf8');
  const parsed = parseDotenv(content);

  const values: Record<string, string> = {};
  for (const key of config.include) {
    const raw = parsed[key];
    if (raw === undefined) {
      continue;
    }
    values[key] = String(raw);
  }

  const required = config.required ?? [];
  for (const key of required) {
    const value = values[key];
    if (value === undefined || value.trim() === '') {
      throw new Error(
        `Required environment variable "${key}" is missing or empty in ${config.file}`,
      );
    }
  }

  const secretValues = Object.values(values).filter((value) => value.length > 0);
  return { values, secretValues, config };
}

/**
 * Merge daemon env, selected project values, then Gojo platform vars.
 * Platform `GOJO_*` always wins over project file values.
 */
export function buildAgentProcessEnv(input: {
  daemonEnv: NodeJS.ProcessEnv | Record<string, string | undefined>;
  projectValues: Record<string, string>;
  platformEnv: Record<string, string>;
}): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.daemonEnv)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(input.projectValues)) {
    if (key.startsWith('GOJO_')) {
      continue;
    }
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(input.platformEnv)) {
    merged[key] = value;
  }
  return merged;
}

/** Redact known secret values from operator-facing text (longest-first). */
export function redactSecretValues(
  text: string,
  secretValues: readonly string[],
): string {
  if (secretValues.length === 0 || text.length === 0) {
    return text;
  }
  const unique = [...new Set(secretValues.filter((value) => value.length > 0))];
  unique.sort((a, b) => b.length - a.length);
  let redacted = text;
  for (const value of unique) {
    redacted = redacted.split(value).join('***');
  }
  return redacted;
}
