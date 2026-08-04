import { describe, expect, test } from "bun:test";

import {
  mapCursorStreamEvent,
  resolveAssistantTextDelta,
  toolSummaryFromPayload,
} from "@/infrastructure/agent-adapters/stream-json";

describe("resolveAssistantTextDelta", () => {
  test("emits incremental tokens without inventing newlines", () => {
    let previous = "";
    const out: string[] = [];
    for (const token of ["I'll", " start", " by", " measuring"]) {
      const delta = resolveAssistantTextDelta(previous, token);
      expect(delta).not.toBeNull();
      out.push(delta!.emit);
      previous = delta!.nextPrevious;
    }
    expect(out.join("")).toBe("I'll start by measuring");
    expect(out.every((piece) => !piece.includes("\n"))).toBe(true);
  });

  test("emits only the suffix for cumulative snapshots", () => {
    let previous = "";
    const out: string[] = [];
    for (const snapshot of ["I'll", "I'll start", "I'll start by"]) {
      const delta = resolveAssistantTextDelta(previous, snapshot);
      expect(delta).not.toBeNull();
      out.push(delta!.emit);
      previous = delta!.nextPrevious;
    }
    expect(out).toEqual(["I'll", " start", " by"]);
    expect(previous).toBe("I'll start by");
  });

  test("skips exact duplicates and shorter rewinds", () => {
    expect(resolveAssistantTextDelta("hello", "hello")).toBeNull();
    expect(resolveAssistantTextDelta("hello world", "hello")).toBeNull();
  });
});

describe("mapCursorStreamEvent", () => {
  test("extracts assistant text parts", () => {
    const events = mapCursorStreamEvent({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(events).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("maps tool_call with path summary", () => {
    const events = mapCursorStreamEvent({
      type: "tool_call",
      subtype: "started",
      call_id: "c1",
      tool_call: {
        readToolCall: {
          args: { path: "src/main.ts" },
        },
      },
    });
    expect(events).toEqual([
      {
        kind: "tool",
        phase: "started",
        callId: "c1",
        name: "read",
        summary: "src/main.ts",
      },
    ]);
  });

  test("maps shell tool_call with command summary", () => {
    const events = mapCursorStreamEvent({
      type: "tool_call",
      subtype: "completed",
      call_id: "c2",
      tool_call: {
        shellToolCall: {
          args: { command: "bun test" },
        },
      },
    });
    expect(events).toEqual([
      {
        kind: "tool",
        phase: "completed",
        callId: "c2",
        name: "shell",
        summary: "bun test",
      },
    ]);
  });
});

describe("toolSummaryFromPayload", () => {
  test("prefers path and pattern when both present", () => {
    expect(
      toolSummaryFromPayload({
        grepToolCall: {
          args: { path: "web/src", pattern: "buildActivity" },
        },
      }),
    ).toBe("web/src · buildActivity");
  });

  test("returns undefined without useful args", () => {
    expect(toolSummaryFromPayload({ readToolCall: { args: {} } })).toBeUndefined();
    expect(toolSummaryFromPayload(null)).toBeUndefined();
  });
});
