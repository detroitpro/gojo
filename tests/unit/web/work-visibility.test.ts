import { describe, expect, test } from "bun:test";

import { isVerifiedActiveDelivery } from "../../../web/src/lib/work-visibility";

describe("isVerifiedActiveDelivery", () => {
  test("includes only source-current active delivery work", () => {
    expect(isVerifiedActiveDelivery({ delivery: "open", syncState: "current" })).toBe(true);
    expect(isVerifiedActiveDelivery({ delivery: "draft", syncState: "current" })).toBe(true);
    expect(isVerifiedActiveDelivery({ delivery: "open", syncState: "stale" })).toBe(false);
    expect(isVerifiedActiveDelivery({ delivery: "open", syncState: "error" })).toBe(false);
  });

  test("excludes terminal delivery work", () => {
    expect(isVerifiedActiveDelivery({ delivery: "merged", syncState: "current" })).toBe(false);
    expect(isVerifiedActiveDelivery({ delivery: "closed", syncState: "current" })).toBe(false);
  });
});
