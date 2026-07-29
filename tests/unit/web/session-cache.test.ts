import { describe, expect, test } from "bun:test";

describe("checkSession cache", () => {
  test("probes /instance once then serves the cache", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/instance")) {
        return new Response(JSON.stringify({ data: { bindHost: "127.0.0.1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
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
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(forced).not.toBeNull();
      const instanceCalls = calls.filter((url) => url.includes("/instance"));
      expect(instanceCalls).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
