import { describe, expect, test } from "bun:test";

import {
  mapCursorStreamEvent,
  resolveAssistantTextDelta,
} from "@/agents/stream-json";

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
});
