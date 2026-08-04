import { describe, expect, test } from "bun:test";

import { describeCron } from "@shared/cron-describe";

describe("describeCron", () => {
  test("describes common expressions", () => {
    expect(describeCron("0 * * * *").toLowerCase()).toContain("hour");
    expect(describeCron("0 9 * * 1").toLowerCase()).toMatch(/monday|am|9/);
  });

  test("falls back to raw expression on parse failure", () => {
    expect(describeCron("not a cron")).toBe("not a cron");
  });
});
