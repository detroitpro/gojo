import { describe, expect, test } from "bun:test";

import {
  checkNetworkStartGates,
  defaultInstanceConfig,
  expandTrustedProxies,
  isLoopbackHost,
  normalizePublicBaseUrl,
  resolveApiBaseUrl,
} from "@/platform/config/instance";

describe("config/instance network", () => {
  test("isLoopbackHost recognizes common loopback forms", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
  });

  test("normalizePublicBaseUrl strips trailing slash and validates scheme", () => {
    expect(normalizePublicBaseUrl("https://gojo.example.com/")).toBe("https://gojo.example.com");
    expect(normalizePublicBaseUrl("http://192.168.4.73:7430")).toBe("http://192.168.4.73:7430");
    expect(() => normalizePublicBaseUrl("ftp://x")).toThrow(/http or https/);
    expect(normalizePublicBaseUrl(null)).toBeNull();
  });

  test("resolveApiBaseUrl prefers publicBaseUrl and never uses 0.0.0.0", () => {
    const base = defaultInstanceConfig("/data");
    expect(resolveApiBaseUrl(base)).toBe("http://127.0.0.1:7430/api/v1");

    expect(
      resolveApiBaseUrl({
        ...base,
        publicBaseUrl: "https://gojo.example.com",
        bindHost: "0.0.0.0",
      }),
    ).toBe("https://gojo.example.com/api/v1");

    expect(() =>
      resolveApiBaseUrl({
        ...base,
        bindHost: "0.0.0.0",
        publicBaseUrl: null,
      }),
    ).toThrow(/publicBaseUrl is required/);
  });

  test("checkNetworkStartGates enforces users + publicBaseUrl for non-loopback", () => {
    const base = defaultInstanceConfig("/data");
    expect(checkNetworkStartGates(base, false).ok).toBe(true);

    const open = { ...base, bindHost: "0.0.0.0" };
    const noUsers = checkNetworkStartGates(open, false);
    expect(noUsers.ok).toBe(false);
    expect(noUsers.errors.some((e) => /setup/i.test(e))).toBe(true);
    expect(noUsers.errors.some((e) => /publicBaseUrl/i.test(e))).toBe(true);

    const withUrl = checkNetworkStartGates(
      { ...open, publicBaseUrl: "http://192.168.4.73:7430" },
      true,
    );
    expect(withUrl.ok).toBe(true);
  });

  test("expandTrustedProxies expands cloudflare token", () => {
    const expanded = expandTrustedProxies(["cloudflare", "127.0.0.1"]);
    expect(expanded).toContain("127.0.0.1");
    expect(expanded).toContain("172.64.0.0/13");
    expect(expanded.length).toBeGreaterThan(10);
  });
});
