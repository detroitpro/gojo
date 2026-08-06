import { describe, expect, test } from "bun:test";

import { isTimeoutString, parseTimeout } from "@/platform/duration";

describe("platform/duration", () => {
  test("parseTimeout and isTimeoutString accept supported duration grammar", () => {
    expect(parseTimeout(" 1.5s ")).toBe(1_500);
    expect(parseTimeout("250ms")).toBe(250);
    expect(isTimeoutString("10m")).toBe(true);
    expect(isTimeoutString("10x")).toBe(false);
    expect(() => parseTimeout("bad")).toThrow(/Invalid timeout format/);
  });
});
