import { describe, expect, test } from "bun:test";

import {
  failureMessage,
  isUseCaseFailure,
  useCaseFailure,
} from "@/platform/errors";

describe("platform/errors", () => {
  test("failureMessage extracts typed, string, Error, and unknown values", () => {
    expect(failureMessage(useCaseFailure("not_found", "missing agent").error)).toBe(
      "missing agent",
    );
    expect(failureMessage("plain string")).toBe("plain string");
    expect(failureMessage(new Error("boom"))).toBe("boom");
    expect(failureMessage(404)).toBe("404");
  });

  test("isUseCaseFailure accepts typed failures and rejects malformed objects", () => {
    expect(isUseCaseFailure({ code: "x", message: "y" })).toBe(true);
    expect(isUseCaseFailure({ code: "x" })).toBe(false);
    expect(isUseCaseFailure(null)).toBe(false);
    expect(isUseCaseFailure("nope")).toBe(false);
  });
});
