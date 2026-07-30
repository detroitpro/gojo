import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parse, stringify } from "yaml";

export type CookieSecureMode = "auto" | "always" | "never";

export interface InstanceConfig {
  bindHost: string;
  bindPort: number;
  dataDir: string;
  paused: boolean;
  telemetryEnabled: boolean;
  /** Canonical public URL for UI/agents/CSRF. Required when bind is non-loopback. */
  publicBaseUrl: string | null;
  /** CIDRs/IPs (or the token "cloudflare") allowed to set X-Forwarded-* headers. */
  trustedProxies: string[];
  /** CORS + CSRF origins; empty means origin of publicBaseUrl only. */
  allowedOrigins: string[];
  /** Optional client IP allowlist after proxy resolution; empty means any. */
  ipAllowlist: string[];
  cookieSecure: CookieSecureMode;
}

export const DEFAULT_BIND_HOST = "127.0.0.1";
export const DEFAULT_BIND_PORT = 7430;

/** Published Cloudflare IP ranges (IPv4 + IPv6). Expand when trustedProxies includes "cloudflare". */
export const CLOUDFLARE_PROXY_CIDRS: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

export function defaultInstanceConfig(dataDir: string): InstanceConfig {
  return {
    bindHost: DEFAULT_BIND_HOST,
    bindPort: DEFAULT_BIND_PORT,
    dataDir,
    paused: false,
    telemetryEnabled: false,
    publicBaseUrl: null,
    trustedProxies: [],
    allowedOrigins: [],
    ipAllowlist: [],
    cookieSecure: "auto",
  };
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]" ||
    h === "0:0:0:0:0:0:0:1"
  );
}

export function expandTrustedProxies(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "cloudflare") {
      out.push(...CLOUDFLARE_PROXY_CIDRS);
      continue;
    }
    out.push(trimmed);
  }
  return [...new Set(out)];
}

export function normalizePublicBaseUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`publicBaseUrl is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("publicBaseUrl must use http or https");
  }
  return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")}`;
}

export function resolveApiBaseUrl(config: InstanceConfig): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/, "")}/api/v1`;
  }
  if (isLoopbackHost(config.bindHost)) {
    return `http://127.0.0.1:${config.bindPort}/api/v1`;
  }
  throw new Error(
    "publicBaseUrl is required when bindHost is not loopback (agent callbacks cannot use 0.0.0.0)",
  );
}

export interface NetworkStartGateResult {
  ok: boolean;
  errors: string[];
}

/**
 * Hard gates before listening on a non-loopback address (PRD §25.14).
 * Call with whether any admin user exists.
 */
export function checkNetworkStartGates(
  config: InstanceConfig,
  hasUsers: boolean,
): NetworkStartGateResult {
  const errors: string[] = [];
  if (config.bindPort < 1 || config.bindPort > 65535 || !Number.isInteger(config.bindPort)) {
    errors.push("bindPort must be an integer between 1 and 65535");
  }
  if (!isLoopbackHost(config.bindHost)) {
    if (!hasUsers) {
      errors.push(
        "Cannot bind to a non-loopback address before setup — run `gojo setup` with bindHost 127.0.0.1 first",
      );
    }
    if (!config.publicBaseUrl) {
      errors.push(
        "publicBaseUrl is required when bindHost is not loopback (e.g. https://gojo.example.com or http://192.168.x.x:7430)",
      );
    }
  }
  if (config.publicBaseUrl) {
    try {
      normalizePublicBaseUrl(config.publicBaseUrl);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: errors.length === 0, errors };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeConfig(raw: unknown, fallbackDataDir: string): InstanceConfig {
  const defaults = defaultInstanceConfig(fallbackDataDir);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const record = raw as Record<string, unknown>;
  const cookieRaw = record["cookieSecure"];
  const cookieSecure: CookieSecureMode =
    cookieRaw === "always" || cookieRaw === "never" || cookieRaw === "auto"
      ? cookieRaw
      : defaults.cookieSecure;

  let publicBaseUrl: string | null = defaults.publicBaseUrl;
  if (typeof record["publicBaseUrl"] === "string") {
    publicBaseUrl = normalizePublicBaseUrl(record["publicBaseUrl"]);
  } else if (record["publicBaseUrl"] === null) {
    publicBaseUrl = null;
  }

  return {
    bindHost: typeof record["bindHost"] === "string" ? record["bindHost"] : defaults.bindHost,
    bindPort: typeof record["bindPort"] === "number" ? record["bindPort"] : defaults.bindPort,
    dataDir: typeof record["dataDir"] === "string" ? record["dataDir"] : defaults.dataDir,
    paused: typeof record["paused"] === "boolean" ? record["paused"] : defaults.paused,
    telemetryEnabled:
      typeof record["telemetryEnabled"] === "boolean"
        ? record["telemetryEnabled"]
        : defaults.telemetryEnabled,
    publicBaseUrl,
    trustedProxies: asStringArray(record["trustedProxies"]),
    allowedOrigins: asStringArray(record["allowedOrigins"]),
    ipAllowlist: asStringArray(record["ipAllowlist"]),
    cookieSecure,
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
