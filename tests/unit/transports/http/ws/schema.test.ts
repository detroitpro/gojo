import { describe, expect, test } from "bun:test";

import { parseClientFrame } from "@/transports/http/ws/schema";

describe("parseClientFrame", () => {
  test("parses req, platform sub, run sub, and unsub", () => {
    expect(
      parseClientFrame(
        JSON.stringify({ t: "req", id: 1, method: "GET", path: "/api/v1/health" }),
      ).ok,
    ).toBe(true);
    expect(
      parseClientFrame(
        JSON.stringify({
          t: "sub",
          id: 2,
          channel: "platform",
          topics: ["dashboard"],
          after: 0,
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseClientFrame(
        JSON.stringify({
          t: "sub",
          id: 3,
          channel: "run",
          runId: "run-1",
          after: { durable: 0, live: 0 },
        }),
      ).ok,
    ).toBe(true);
    expect(parseClientFrame(JSON.stringify({ t: "unsub", id: 2 })).ok).toBe(true);
  });

  test("rejects malformed frames", () => {
    expect(parseClientFrame("not-json").ok).toBe(false);
    expect(parseClientFrame(JSON.stringify({ t: "nope" })).ok).toBe(false);
    expect(
      parseClientFrame(JSON.stringify({ t: "sub", id: 1, channel: "other" })).ok,
    ).toBe(false);
  });
});
