// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";

describe("checkSession cache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("probes /auth/me once then serves the cache", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            data: { user: { id: "u1", username: "admin", role: "admin" } },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const mod = await import("@/contexts/access/api");
      const first = await mod.checkSession();
      const second = await mod.checkSession();
      const forced = await mod.checkSession({ force: true });
      expect(first).toEqual({ id: "u1", username: "admin", role: "admin" });
      expect(second).toEqual(first);
      expect(forced).toEqual(first);
      const meCalls = calls.filter((url) => url.includes("/auth/me"));
      expect(meCalls).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
