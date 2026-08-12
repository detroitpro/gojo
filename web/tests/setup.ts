import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// React 18 needs this flag so RTL can wrap effects/state updates in act(). Without
// it, effect-driven updates emit "not configured to support act(...)" warnings and
// occasionally desynchronize the DOM in strict mode.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom exposes a real fetch that will try to connect to the origin
// (localhost:3000) when a component calls an unmocked API. Fail loudly with a
// synthetic 500 so we get a stable test signal instead of ECONNREFUSED spam.
const originalFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/api/") || url.includes("127.0.0.1") || url.includes("localhost")) {
    return new Response(
      JSON.stringify({ error: { code: "unmocked_fetch", message: `Unmocked fetch: ${url}` } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return originalFetch(input as RequestInfo, init);
}) as typeof fetch;

// RTL only auto-registers cleanup when `afterEach` is a global. Vitest defaults to
// `globals: false`, so unmount the previous test's DOM ourselves before the next
// render mounts on top of it. Also wipe session/local storage so leaked cursors
// (e.g. `gojo.platform.cursor`) don't silently gate platform-event delivery in
// the next test.
beforeEach(() => {
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
    window.localStorage.clear();
  }
});

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
    window.localStorage.clear();
  }
});
