import { describe, expect, test } from "bun:test";

describe("checkSession cache", () => {
  test("probes /auth/me once then serves the cache", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
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
      // Fresh module instance so cache starts unknown.
      const mod = await import(`../../../web/src/api.ts?cache=${Date.now()}`);
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
