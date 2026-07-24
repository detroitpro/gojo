import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parse, stringify } from "yaml";

export interface InstanceConfig {
  bindHost: string;
  bindPort: number;
  dataDir: string;
  paused: boolean;
  telemetryEnabled: boolean;
}

export const DEFAULT_BIND_HOST = "127.0.0.1";
export const DEFAULT_BIND_PORT = 7430;

export function defaultInstanceConfig(dataDir: string): InstanceConfig {
  return {
    bindHost: DEFAULT_BIND_HOST,
    bindPort: DEFAULT_BIND_PORT,
    dataDir,
    paused: false,
    telemetryEnabled: false,
  };
}

function normalizeConfig(raw: unknown, fallbackDataDir: string): InstanceConfig {
  const defaults = defaultInstanceConfig(fallbackDataDir);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const record = raw as Record<string, unknown>;
  return {
    bindHost: typeof record["bindHost"] === "string" ? record["bindHost"] : defaults.bindHost,
    bindPort: typeof record["bindPort"] === "number" ? record["bindPort"] : defaults.bindPort,
    dataDir: typeof record["dataDir"] === "string" ? record["dataDir"] : defaults.dataDir,
    paused: typeof record["paused"] === "boolean" ? record["paused"] : defaults.paused,
    telemetryEnabled:
      typeof record["telemetryEnabled"] === "boolean"
        ? record["telemetryEnabled"]
        : defaults.telemetryEnabled,
  };
}

export function loadInstanceConfig(configPath: string, fallbackDataDir: string): InstanceConfig {
  if (!existsSync(configPath)) {
    return defaultInstanceConfig(fallbackDataDir);
  }

  const contents = readFileSync(configPath, "utf8");
  const parsed: unknown = parse(contents);
  return normalizeConfig(parsed, fallbackDataDir);
}

export function saveInstanceConfig(configPath: string, config: InstanceConfig): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, stringify(config), "utf8");
}
