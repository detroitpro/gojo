import { describe, expect, test } from "bun:test";

import {
  matchesPlatformEvent,
  sequenceFromRequest,
} from "@/platform/events/platform-event-filter";
import type { PlatformChangeEvent } from "@shared/events";

function event(overrides: Partial<PlatformChangeEvent> = {}): PlatformChangeEvent {
  return {
    sequence: 1,
    id: "evt-1",
    projectId: "project-1",
    type: "run.created",
    entityKind: "run",
    entityId: "run-1",
    topics: ["runs", "dashboard"],
    data: {},
    occurredAt: "2026-07-29T12:00:00.000Z",
    createdAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("matchesPlatformEvent", () => {
  test("filters by project and topic", () => {
    const e = event();
    expect(matchesPlatformEvent(e, { projectId: "project-1" })).toBe(true);
    expect(matchesPlatformEvent(e, { projectId: "project-2" })).toBe(false);
    expect(matchesPlatformEvent(e, { topics: ["dashboard"] })).toBe(true);
    expect(matchesPlatformEvent(e, { topics: ["agents"] })).toBe(false);
    expect(
      matchesPlatformEvent(e, { projectId: "project-1", topics: ["queue"] }),
    ).toBe(false);
  });
});

describe("sequenceFromRequest", () => {
  test("uses the greater of Last-Event-ID and after query, ignoring non-finite values", () => {
    const request = new Request("https://gojo.local/events?after=12", {
      headers: { "Last-Event-ID": "42" },
    });
    expect(sequenceFromRequest(request)).toBe(42);

    const invalid = new Request("https://gojo.local/events?after=not-a-number", {
      headers: { "Last-Event-ID": "7" },
    });
    expect(sequenceFromRequest(invalid)).toBe(7);
  });
});
