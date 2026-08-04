import {
  expandTrustedProxies,
  isLoopbackHost,
  type CookieSecureMode,
  type InstanceConfig,
} from "@/platform/config/instance";

export type RequestProto = "http" | "https";

export interface ResolvedClient {
  ip: string;
  proto: RequestProto;
  trustedProxy: boolean;
}

/** Parse IPv4 "a.b.c.d" into a 32-bit number, or null. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  if (!base) return false;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipv4ToInt(ip);
  const baseN = ipv4ToInt(base);
  if (ipN == null || baseN == null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

/** Very small IPv6 CIDR check: exact match or prefix when both expand. */
function expandIpv6(ip: string): number[] | null {
  let raw = ip.trim().toLowerCase();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    raw = raw.slice(1, -1);
  }
  if (raw.includes(".")) {
    // IPv4-mapped not handled
    return null;
  }
  const sides = raw.split("::");
  if (sides.length > 2) return null;
  const head = sides[0] ? sides[0].split(":").filter(Boolean) : [];
  const tail = sides.length === 2 && sides[1] ? sides[1].split(":").filter(Boolean) : [];
  if (head.length + tail.length > 8) return null;
  const mid = sides.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [
    ...head,
    ...Array.from({ length: mid }, () => "0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    const v = Number.parseInt(g, 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) return null;
    out.push(v);
  }
  return out;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  if (!base) return false;
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const ipG = expandIpv6(ip);
  const baseG = expandIpv6(base);
  if (!ipG || !baseG) return false;
  let remaining = bits;
  for (let i = 0; i < 8; i++) {
    if (remaining <= 0) return true;
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : (~0 << (16 - take)) & 0xffff;
    if ((ipG[i]! & mask) !== (baseG[i]! & mask)) return false;
    remaining -= take;
  }
  return true;
}

export function ipMatches(ip: string, rule: string): boolean {
  const trimmed = rule.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("/")) {
    return ip.trim().toLowerCase() === trimmed.toLowerCase() ||
      (trimmed === "127.0.0.1" && isLoopbackHost(ip));
  }
  if (trimmed.includes(":")) {
    return ipv6InCidr(ip, trimmed);
  }
  return ipv4InCidr(ip, trimmed);
}

export function ipInList(ip: string, rules: string[]): boolean {
  return rules.some((rule) => ipMatches(ip, rule));
}

function peerIpFromRequest(request: Request): string {
  // Bun may expose server request IP via headers in some setups; fall back to
  // a loopback placeholder when unavailable (local tests).
  const bunIp = (request as Request & { ip?: string }).ip;
  if (typeof bunIp === "string" && bunIp.length > 0) {
    return bunIp.replace(/^::ffff:/, "");
  }
  return "127.0.0.1";
}

export function resolveClient(
  request: Request,
  config: InstanceConfig,
  peerIp = peerIpFromRequest(request),
): ResolvedClient {
  const trusted = expandTrustedProxies(config.trustedProxies);
  const peer = peerIp.replace(/^::ffff:/, "");
  const trustedProxy = trusted.length > 0 && ipInList(peer, trusted);

  let ip = peer;
  let proto: RequestProto = "http";

  if (trustedProxy) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) ip = first.replace(/^::ffff:/, "");
    }
    const xfp = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (xfp === "https" || xfp === "http") {
      proto = xfp;
    }
  }

  return { ip, proto, trustedProxy };
}

export function shouldSetSecureCookie(
  mode: CookieSecureMode,
  proto: RequestProto,
): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return proto === "https";
}

function configuredOrigins(config: InstanceConfig): string[] {
  if (config.allowedOrigins.length > 0) {
    return config.allowedOrigins;
  }
  if (config.publicBaseUrl) {
    return [new URL(config.publicBaseUrl).origin];
  }
  return [];
}

/** Origins permitted for CSRF/CORS (for diagnostics). */
export function listAllowedOrigins(config: InstanceConfig): string[] {
  return configuredOrigins(config);
}

/** Read the browser Origin header, or derive it from Referer. */
export function browserOriginFromRequest(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }
  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the browser origin for a session-backed request.
 * Loopback installs without publicBaseUrl may omit Origin on same-host traffic.
 */
export function resolveBrowserOriginForSession(
  request: Request,
  config: InstanceConfig,
): string | null {
  const fromHeaders = browserOriginFromRequest(request);
  if (fromHeaders) {
    return fromHeaders;
  }
  if (config.publicBaseUrl == null && isLoopbackHost(config.bindHost)) {
    try {
      return new URL(request.url).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function csrfFailureMessage(request: Request, config: InstanceConfig): string {
  const received = browserOriginFromRequest(request) ?? "(none)";
  const allowed = configuredOrigins(config);
  let allowHint: string;
  if (allowed.length > 0) {
    allowHint = allowed.join(", ");
  } else if (isLoopbackHost(config.bindHost)) {
    allowHint = "same origin as the API host (loopback default)";
  } else {
    allowHint = "(unset — set publicBaseUrl)";
  }
  return (
    `CSRF check failed — Origin/Referer not allowed (received ${received}; allowed: ${allowHint}). ` +
    "Set publicBaseUrl or allowedOrigins in instance settings."
  );
}

export function originAllowed(
  origin: string | null,
  config: InstanceConfig,
  requestUrl?: string,
): boolean {
  if (!origin) return false;
  const allowed = configuredOrigins(config);
  if (allowed.some((entry) => entry === origin || entry === "*")) {
    return true;
  }
  // Localhost default: same-origin browser requests (UI served from the API host).
  if (allowed.length === 0 && isLoopbackHost(config.bindHost) && requestUrl) {
    try {
      return origin === new URL(requestUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** CSRF check for cookie-authenticated mutating requests. */
export function csrfOk(request: Request, config: InstanceConfig): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    return originAllowed(origin, config, request.url);
  }
  const referer = request.headers.get("referer");
  if (!referer) {
    // Same-site navigations without Origin (some older clients) — allow when
    // publicBaseUrl is unset (localhost default) only.
    return config.publicBaseUrl == null && isLoopbackHost(config.bindHost);
  }
  try {
    return originAllowed(new URL(referer).origin, config, request.url);
  } catch {
    return false;
  }
}

export function corsHeaders(
  request: Request,
  config: InstanceConfig,
): Record<string, string> | null {
  const origin = request.headers.get("origin");
  if (!origin || !originAllowed(origin, config, request.url)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  };
}

interface RateBucket {
  timestamps: number[];
}

const loginBuckets = new Map<string, RateBucket>();

export function resetRateLimitsForTests(): void {
  loginBuckets.clear();
}

/**
 * Returns true if the IP is still under the failure budget.
 * Call {@link recordAuthFailure} only after a failed login/setup attempt.
 * Default: 10 failures / 5 minutes per IP.
 */
export function checkAuthRateLimit(
  ip: string,
  options?: { limit?: number; windowMs?: number; now?: number },
): boolean {
  const limit = options?.limit ?? 10;
  const windowMs = options?.windowMs ?? 5 * 60 * 1000;
  const now = options?.now ?? Date.now();
  const bucket = loginBuckets.get(ip);
  if (!bucket) {
    return true;
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  return bucket.timestamps.length < limit;
}

/** Record a failed login/setup attempt against the sliding window. */
export function recordAuthFailure(
  ip: string,
  options?: { now?: number },
): void {
  const now = options?.now ?? Date.now();
  let bucket = loginBuckets.get(ip);
  if (!bucket) {
    bucket = { timestamps: [] };
    loginBuckets.set(ip, bucket);
  }
  bucket.timestamps.push(now);
}
