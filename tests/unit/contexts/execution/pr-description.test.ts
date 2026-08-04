import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPrDescription } from "@/contexts/execution/infrastructure/integration/pr-description";

describe("buildPrDescription", () => {
  test("uses handoff summary first line as title and rich body sections", () => {
    const pr = buildPrDescription({
      agentName: "maintain-tests",
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
      agentName: "maintain-deps",
      runId: "run-2",
      fallbackTitle: "gojo: maintain-deps (run-2)",
    });

    expect(pr.title).toBe("gojo: maintain-deps (run-2)");
    expect(pr.body).toContain("Automated gojo agent `maintain-deps` completed.");
    expect(pr.body).toContain("run `run-2`");
  });

  test("truncates long summary titles", () => {
    const long =
      "This is a very long first line that should be truncated for GitHub PR title length limits and stay readable";
    const pr = buildPrDescription({
      agentName: "t",
      runId: "r",
      fallbackTitle: "fallback",
      handoff: { summary: long },
    });
    expect(pr.title.length).toBeLessThanOrEqual(72);
    expect(pr.title.endsWith("…")).toBe(true);
  });

  test("prefers pr-body and pr-title assets over synthesized sections", () => {
    const root = mkdtempSync(join(tmpdir(), "gojo-pr-"));
    mkdirSync(join(root, ".gojo"), { recursive: true });
    writeFileSync(
      join(root, ".gojo", "pr-body.md"),
      "## Custom PR\n\nVerbose details here.\n",
      "utf8",
    );

    const pr = buildPrDescription({
      agentName: "maintain-tests",
      runId: "01KYTEST000000000000000099",
      fallbackTitle: "fallback",
      workspacePath: root,
      handoff: {
        summary: "Should not become title when pr-title present",
        decisions: ["Should not appear in body"],
        assets: [
          { role: "pr-title", content: "Custom title from asset" },
          { role: "pr-body", path: ".gojo/pr-body.md" },
        ],
      },
    });

    expect(pr.title).toBe("Custom title from asset");
    expect(pr.body).toContain("## Custom PR");
    expect(pr.body).toContain("Verbose details here.");
    expect(pr.body).not.toContain("## Decisions");
    expect(pr.body).toContain("Opened by **gojo**");
    expect(pr.body).toContain("01KYTEST000000000000000099");
  });

  test("uses inline pr-body content without workspace", () => {
    const pr = buildPrDescription({
      agentName: "t",
      runId: "r1",
      fallbackTitle: "fallback",
      handoff: {
        summary: "Summary title line",
        assets: [{ role: "pr-body", content: "Inline body only" }],
      },
    });
    expect(pr.title).toBe("Summary title line");
    expect(pr.body).toContain("Inline body only");
    expect(pr.body).toContain("Opened by **gojo**");
  });
});
