import { afterEach, describe, expect, test } from "bun:test";

import {
  browserOriginFromRequest,
  checkAuthRateLimit,
  corsHeaders,
  csrfFailureMessage,
  csrfOk,
  ipInList,
  ipMatches,
  listAllowedOrigins,
  recordAuthFailure,
  resetRateLimitsForTests,
  resolveBrowserOriginForSession,
  resolveClient,
  shouldSetSecureCookie,
} from "@/transports/http/network";
import { defaultInstanceConfig, type InstanceConfig } from "@/platform/config/instance";

function cfg(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return { ...defaultInstanceConfig("/tmp/gojo-data"), ...overrides };
}

describe("api/network", () => {
  afterEach(() => {
    resetRateLimitsForTests();
  });

  test("ipMatches IPv4 exact and CIDR", () => {
    expect(ipMatches("192.168.1.10", "192.168.1.10")).toBe(true);
    expect(ipMatches("192.168.1.10", "192.168.1.0/24")).toBe(true);
    expect(ipMatches("192.168.2.10", "192.168.1.0/24")).toBe(false);
    expect(ipInList("10.0.0.5", ["10.0.0.0/8", "127.0.0.1"])).toBe(true);
  });

  test("resolveClient ignores forwarded headers unless peer is trusted", () => {
    const request = new Request("http://localhost/api/v1/health", {
      headers: {
        "x-forwarded-for": "203.0.113.9",
        "x-forwarded-proto": "https",
      },
    });

    const untrusted = resolveClient(request, cfg({ trustedProxies: [] }), "10.0.0.1");
    expect(untrusted.ip).toBe("10.0.0.1");
    expect(untrusted.proto).toBe("http");
    expect(untrusted.trustedProxy).toBe(false);

    const trusted = resolveClient(
      request,
      cfg({ trustedProxies: ["10.0.0.0/8"] }),
      "10.0.0.1",
    );
    expect(trusted.ip).toBe("203.0.113.9");
    expect(trusted.proto).toBe("https");
    expect(trusted.trustedProxy).toBe(true);
  });

  test("cloudflare token expands and matches CF ranges", () => {
    const request = new Request("http://localhost/", {
      headers: {
        "x-forwarded-for": "198.51.100.20",
        "x-forwarded-proto": "https",
      },
    });
    const client = resolveClient(
      request,
      cfg({ trustedProxies: ["cloudflare"] }),
      "172.64.0.10",
    );
    expect(client.trustedProxy).toBe(true);
    expect(client.ip).toBe("198.51.100.20");
    expect(client.proto).toBe("https");
  });

  test("cookieSecure auto follows resolved proto", () => {
    expect(shouldSetSecureCookie("auto", "https")).toBe(true);
    expect(shouldSetSecureCookie("auto", "http")).toBe(false);
    expect(shouldSetSecureCookie("always", "http")).toBe(true);
    expect(shouldSetSecureCookie("never", "https")).toBe(false);
  });

  test("csrfOk allows Origin matching publicBaseUrl; Bearer path not used here", () => {
    const config = cfg({ publicBaseUrl: "https://gojo.example.com" });
    const ok = new Request("https://gojo.example.com/api/v1/instance", {
      method: "PATCH",
      headers: { Origin: "https://gojo.example.com" },
    });
    expect(csrfOk(ok, config)).toBe(true);

    const bad = new Request("https://gojo.example.com/api/v1/instance", {
      method: "PATCH",
      headers: { Origin: "https://evil.example" },
    });
    expect(csrfOk(bad, config)).toBe(false);

    const local = cfg();
    const noOrigin = new Request("http://127.0.0.1:7430/api/v1/instance", {
      method: "PATCH",
    });
    expect(csrfOk(noOrigin, local)).toBe(true);

    const sameOrigin = new Request("http://127.0.0.1:7430/api/v1/instance", {
      method: "PATCH",
      headers: { Origin: "http://127.0.0.1:7430" },
    });
    expect(csrfOk(sameOrigin, local)).toBe(true);
  });

  test("browserOriginFromRequest prefers Origin then Referer", () => {
    const withOrigin = new Request("http://localhost/", {
      headers: { Origin: "https://gojo.example.com" },
    });
    expect(browserOriginFromRequest(withOrigin)).toBe("https://gojo.example.com");

    const withReferer = new Request("http://localhost/", {
      headers: { Referer: "https://gojo.example.com/settings" },
    });
    expect(browserOriginFromRequest(withReferer)).toBe("https://gojo.example.com");

    const missing = new Request("http://localhost/");
    expect(browserOriginFromRequest(missing)).toBeNull();
  });

  test("resolveBrowserOriginForSession falls back on loopback without publicBaseUrl", () => {
    const local = cfg();
    const request = new Request("http://127.0.0.1:7430/api/v1/instance", { method: "PATCH" });
    expect(resolveBrowserOriginForSession(request, local)).toBe("http://127.0.0.1:7430");

    const remote = cfg({ publicBaseUrl: "https://gojo.example.com" });
    expect(resolveBrowserOriginForSession(request, remote)).toBeNull();
  });

  test("csrfFailureMessage includes received and allowed origins", () => {
    const config = cfg({ publicBaseUrl: "https://gojo.example.com" });
    const request = new Request("https://gojo.example.com/api/v1/instance", {
      method: "PATCH",
      headers: { Origin: "https://evil.example" },
    });
    const message = csrfFailureMessage(request, config);
    expect(message).toContain("https://evil.example");
    expect(message).toContain("https://gojo.example.com");
    expect(message).toContain("publicBaseUrl");
  });

  test("listAllowedOrigins mirrors CSRF allowlist", () => {
    expect(listAllowedOrigins(cfg({ publicBaseUrl: "https://gojo.example.com" }))).toEqual([
      "https://gojo.example.com",
    ]);
    expect(
      listAllowedOrigins(
        cfg({
          publicBaseUrl: "https://gojo.example.com",
          allowedOrigins: ["https://ui.example.com"],
        }),
      ),
    ).toEqual(["https://ui.example.com"]);
  });

  test("corsHeaders only for allowed origins", () => {
    const config = cfg({
      publicBaseUrl: "https://gojo.example.com",
      allowedOrigins: ["https://ui.example.com"],
    });
    const allowed = new Request("https://gojo.example.com/api/v1/health", {
      headers: { Origin: "https://ui.example.com" },
    });
    expect(corsHeaders(allowed, config)?.["Access-Control-Allow-Origin"]).toBe(
      "https://ui.example.com",
    );

    const denied = new Request("https://gojo.example.com/api/v1/health", {
      headers: { Origin: "https://evil.example" },
    });
    expect(corsHeaders(denied, config)).toBeNull();
  });

  test("checkAuthRateLimit sliding window counts failures only", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(checkAuthRateLimit("1.2.3.4", { limit: 10, windowMs: 60_000, now })).toBe(true);
      recordAuthFailure("1.2.3.4", { now });
    }
    expect(checkAuthRateLimit("1.2.3.4", { limit: 10, windowMs: 60_000, now })).toBe(false);
    expect(checkAuthRateLimit("1.2.3.4", { limit: 10, windowMs: 60_000, now: now + 61_000 })).toBe(
      true,
    );
  });
});
