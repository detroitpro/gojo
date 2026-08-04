import { describe, expect, test } from "bun:test";

import { err, isErr, isOk, mapResult, ok } from "@/kernel/result";

describe("kernel/result", () => {
  test("ok and err discriminators", () => {
    const a = ok(42);
    const b = err("nope");
    expect(isOk(a)).toBe(true);
    expect(isErr(b)).toBe(true);
    expect(a.value).toBe(42);
    expect(b.error).toBe("nope");
  });

  test("mapResult transforms ok and preserves err", () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(mapResult(err("x"), (n: number) => n * 3)).toEqual(err("x"));
  });
});
