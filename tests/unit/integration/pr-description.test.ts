import { describe, expect, test } from "bun:test";

import { buildPrDescription } from "@/integration/pr-description";

describe("buildPrDescription", () => {
  test("uses handoff summary first line as title and rich body sections", () => {
    const pr = buildPrDescription({
      taskName: "maintain-tests",
      runId: "01KYTEST000000000000000001",
      fallbackTitle: "gojo: maintain-tests (01KYTEST000000000000000001)",
      handoff: {
        schemaVersion: 1,
        summary:
          "Raise daemon coverage with auth edge-case tests\n\nWhy: auth paths were untested. Value: fewer regressions on login.",
        decisions: [
          "Added 3 tests around token revoke",
          "Ratcheted coverage baseline to 84%",
        ],
        filesChanged: ["tests/unit/auth.test.ts", "coverage-baseline.json"],
        unresolvedIssues: [],
        recommendedNextActions: ["Cover heal enqueue next"],
        status: "completed",
      },
    });

    expect(pr.title).toBe("Raise daemon coverage with auth edge-case tests");
    expect(pr.body).toContain("## Summary");
    expect(pr.body).toContain("Why: auth paths were untested");
    expect(pr.body).toContain("## Decisions");
    expect(pr.body).toContain("Added 3 tests around token revoke");
    expect(pr.body).toContain("## Files changed");
    expect(pr.body).toContain("coverage-baseline.json");
    expect(pr.body).toContain("## Recommended next actions");
    expect(pr.body).toContain("Cover heal enqueue next");
    expect(pr.body).toContain("maintain-tests");
    expect(pr.body).toContain("01KYTEST000000000000000001");
    expect(pr.body).toContain("Opened by **gojo**");
  });

  test("falls back when handoff is missing", () => {
    const pr = buildPrDescription({
      taskName: "maintain-deps",
      runId: "run-2",
      fallbackTitle: "gojo: maintain-deps (run-2)",
    });

    expect(pr.title).toBe("gojo: maintain-deps (run-2)");
    expect(pr.body).toContain("Automated gojo task `maintain-deps` completed.");
    expect(pr.body).toContain("run `run-2`");
  });

  test("truncates long summary titles", () => {
    const long =
      "This is a very long first line that should be truncated for GitHub PR title length limits and stay readable";
    const pr = buildPrDescription({
      taskName: "t",
      runId: "r",
      fallbackTitle: "fallback",
      handoff: { summary: long },
    });
    expect(pr.title.length).toBeLessThanOrEqual(72);
    expect(pr.title.endsWith("…")).toBe(true);
  });
});
