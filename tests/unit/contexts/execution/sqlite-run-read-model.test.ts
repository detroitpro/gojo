import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteRunReadModel } from "@/contexts/execution/infrastructure/sqlite-run-read-model";
import type { AppContext } from "@/platform/app-context";
import { resolvePaths } from "@/platform/config/paths";
import { createRepositories } from "@/platform/create-repositories";
import { Database } from "@/infrastructure/persistence";
import { RunState } from "@shared/run-states";

describe("SqliteRunReadModel", () => {
  let tempDir: string | null = null;
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function readModel(): { model: SqliteRunReadModel; repos: ReturnType<typeof createRepositories> } {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-run-read-model-"));
    const paths = resolvePaths(tempDir);
    db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const ctx = {
      paths,
      repos,
      db,
      approvals: { findByRun: () => null },
    } as unknown as AppContext;
    return { model: new SqliteRunReadModel(ctx), repos };
  }

  test("detail returns null when run is missing", () => {
    const { model } = readModel();
    expect(model.detail("run_missing")).toBeNull();
  });

  test("detail enriches run with project and agent names", () => {
    const { model, repos } = readModel();
    const project = repos.projects.create({
      name: "demo",
      repoPath: join(tempDir!, "repo"),
    });
    const agent = repos.agents.create({
      projectId: project.id,
      name: "maintain-tests",
      prompt: "work",
    });
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "read-model-detail",
      trigger: "schedule",
      state: RunState.Queued,
    });

    const detail = model.detail(run.id);

    expect(detail).not.toBeNull();
    expect(detail?.run.projectName).toBe("demo");
    expect(detail?.run.agentName).toBe("maintain-tests");
    expect(detail?.attempts).toEqual([]);
    expect(detail?.impactItems).toEqual([]);
    expect(detail?.integration).toBeNull();
    expect(detail?.approval).toBeNull();
  });
});
