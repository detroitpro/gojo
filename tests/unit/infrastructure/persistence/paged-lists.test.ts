import { describe, expect, test } from "bun:test";

import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import {
  listAgentsPage,
  listImpactItemsPage,
  listProjectsPage,
  projectSummaryFor,
} from "@/contexts/catalog/infrastructure/catalog-paged-lists";
import { listRunsPage } from "@/contexts/execution/infrastructure/run-paged-lists";
import { listIntegrationsPage } from "@/contexts/delivery/infrastructure/integration-paged-lists";
import { RunState } from "@shared/run-states";

describe("paged-lists", () => {
  test("listRunsPage filters and pages", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const other = repos.projects.create({ name: "other", repoPath: "/tmp/other" });
    const agent = repos.agents.create({
      projectId: project.id,
      name: "maintain-quality",
      prompt: "work",
    });
    const agent2 = repos.agents.create({
      projectId: other.id,
      name: "deps",
      prompt: "work",
    });

    for (let i = 0; i < 3; i += 1) {
      repos.runs.create({
        projectId: project.id,
        agentId: agent.id,
        idempotencyKey: `k-${i}`,
        trigger: "schedule",
        state: RunState.Failed,
      });
    }
    repos.runs.create({
      projectId: other.id,
      agentId: agent2.id,
      idempotencyKey: "other",
      trigger: "manual",
      state: RunState.Succeeded,
    });

    const page = listRunsPage(db, {
      limit: 2,
      offset: 0,
      projectId: project.id,
      state: RunState.Failed,
      q: "quality",
    });

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((run) => run.projectId === project.id)).toBe(true);
    expect(page.items[0]?.agentName).toBe("maintain-quality");

    db.close();
  });

  test("listRunsPage sorts by whitelist columns", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const agentA = repos.agents.create({ projectId: project.id, name: "alpha", prompt: "a" });
    const agentB = repos.agents.create({ projectId: project.id, name: "beta", prompt: "b" });
    repos.runs.create({
      projectId: project.id,
      agentId: agentB.id,
      idempotencyKey: "b",
      trigger: "manual",
      state: RunState.Queued,
    });
    repos.runs.create({
      projectId: project.id,
      agentId: agentA.id,
      idempotencyKey: "a",
      trigger: "manual",
      state: RunState.Queued,
    });

    const asc = listRunsPage(db, {
      limit: 10,
      offset: 0,
      sort: "agentName",
      order: "asc",
    });
    expect(asc.items.map((run) => run.agentName)).toEqual(["alpha", "beta"]);

    const desc = listRunsPage(db, {
      limit: 10,
      offset: 0,
      sort: "agentName",
      order: "desc",
    });
    expect(desc.items.map((run) => run.agentName)).toEqual(["beta", "alpha"]);

    const fallback = listRunsPage(db, {
      limit: 10,
      offset: 0,
      sort: "not-a-column",
      order: "asc",
    });
    expect(fallback.items).toHaveLength(2);

    db.close();
  });

  test("listProjectsPage and listAgentsPage honor sort", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    repos.projects.create({ name: "zeta", repoPath: "/tmp/z" });
    const alpha = repos.projects.create({ name: "alpha", repoPath: "/tmp/a" });
    repos.agents.create({ projectId: alpha.id, name: "z-agent", prompt: "z" });
    repos.agents.create({ projectId: alpha.id, name: "a-agent", prompt: "a" });

    const projects = listProjectsPage(db, {
      limit: 10,
      offset: 0,
      sort: "name",
      order: "asc",
    });
    expect(projects.items.map((p) => p.name)).toEqual(["alpha", "zeta"]);

    const agents = listAgentsPage(db, {
      limit: 10,
      offset: 0,
      projectId: alpha.id,
      sort: "name",
      order: "asc",
    });
    expect(agents.items.map((t) => t.name)).toEqual(["a-agent", "z-agent"]);

    db.close();
  });

  test("listAgentsPage respects enabled filter", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    repos.agents.create({
      projectId: project.id,
      name: "on",
      prompt: "a",
      enabled: true,
    });
    repos.agents.create({
      projectId: project.id,
      name: "off",
      prompt: "b",
      enabled: false,
    });

    const enabled = listAgentsPage(db, { limit: 25, offset: 0, enabled: true });
    expect(enabled.total).toBe(1);
    expect(enabled.items[0]?.name).toBe("on");

    db.close();
  });

  test("listRunsPage filters by agentId", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const agentA = repos.agents.create({
      projectId: project.id,
      name: "agent-a",
      prompt: "a",
    });
    const agentB = repos.agents.create({
      projectId: project.id,
      name: "agent-b",
      prompt: "b",
    });
    repos.runs.create({
      projectId: project.id,
      agentId: agentA.id,
      idempotencyKey: "a1",
      trigger: "manual",
      state: RunState.Succeeded,
    });
    repos.runs.create({
      projectId: project.id,
      agentId: agentB.id,
      idempotencyKey: "b1",
      trigger: "manual",
      state: RunState.Failed,
    });

    const page = listRunsPage(db, { limit: 25, offset: 0, agentId: agentA.id });
    expect(page.total).toBe(1);
    expect(page.items[0]?.agentId).toBe(agentA.id);
    expect(page.items[0]?.agentName).toBe("agent-a");

    db.close();
  });

  test("listAgentsPage includes last-run fields", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const withRun = repos.agents.create({
      projectId: project.id,
      name: "with-run",
      prompt: "a",
    });
    const without = repos.agents.create({
      projectId: project.id,
      name: "without-run",
      prompt: "b",
    });
    const older = repos.runs.create({
      projectId: project.id,
      agentId: withRun.id,
      idempotencyKey: "older",
      trigger: "manual",
      state: RunState.Failed,
    });
    // Ensure newer created_at for latest-run pick.
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", older.id);
    const newer = repos.runs.create({
      projectId: project.id,
      agentId: withRun.id,
      idempotencyKey: "newer",
      trigger: "api",
      state: RunState.Succeeded,
    });

    const page = listAgentsPage(db, { limit: 25, offset: 0 });
    const withRow = page.items.find((agent) => agent.id === withRun.id);
    const withoutRow = page.items.find((agent) => agent.id === without.id);

    expect(withRow?.lastRunId).toBe(newer.id);
    expect(withRow?.lastRunState).toBe(RunState.Succeeded);
    expect(withRow?.lastRunCreatedAt).toBeTruthy();
    expect(withoutRow?.lastRunId).toBeNull();
    expect(withoutRow?.lastRunState).toBeNull();
    expect(withoutRow?.lastRunCreatedAt).toBeNull();

    db.close();
  });

  test("listProjectsPage includes agent/schedule summary and omits manifestJson", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      manifestJson: '{"version":1,"tasks":{}}',
    });
    const empty = repos.projects.create({ name: "empty", repoPath: "/tmp/empty" });
    const on = repos.agents.create({
      projectId: project.id,
      name: "on",
      prompt: "a",
      enabled: true,
    });
    repos.agents.create({
      projectId: project.id,
      name: "off",
      prompt: "b",
      enabled: false,
    });
    repos.schedules.create({
      agentId: on.id,
      name: "on",
      cronExpr: "0 1 * * *",
      enabled: true,
    });
    repos.schedules.create({
      agentId: on.id,
      name: "off-sched",
      cronExpr: "0 2 * * *",
      enabled: false,
    });

    const page = listProjectsPage(db, { limit: 25, offset: 0 });
    const demo = page.items.find((row) => row.id === project.id);
    const bare = page.items.find((row) => row.id === empty.id);

    expect(demo?.enabled).toBe(true);
    expect(demo?.agentCount).toBe(2);
    expect(demo?.enabledAgentCount).toBe(1);
    expect(demo?.scheduleCount).toBe(2);
    expect(demo?.enabledScheduleCount).toBe(1);
    expect(demo?.hasManifest).toBe(true);
    expect(demo?.manifestJson).toBeUndefined();

    expect(bare?.agentCount).toBe(0);
    expect(bare?.hasManifest).toBe(false);

    const summary = projectSummaryFor(db, project.id);
    expect(summary).toEqual({
      agentCount: 2,
      enabledAgentCount: 1,
      scheduleCount: 2,
      enabledScheduleCount: 1,
      hasManifest: true,
      openPrCount: 0,
    });

    db.close();
  });

  test("integrations: open/merged page, filter, and hasOpenPrs", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const withOpen = repos.projects.create({ name: "with-open", repoPath: "/tmp/a" });
    const without = repos.projects.create({ name: "without", repoPath: "/tmp/b" });
    const agentA = repos.agents.create({
      projectId: withOpen.id,
      name: "maintain-quality",
      prompt: "a",
    });
    const agentB = repos.agents.create({
      projectId: withOpen.id,
      name: "maintain-docs",
      prompt: "b",
    });
    const agentC = repos.agents.create({
      projectId: without.id,
      name: "other",
      prompt: "c",
    });

    const runOld = repos.runs.create({
      projectId: withOpen.id,
      agentId: agentA.id,
      idempotencyKey: "old",
      trigger: "manual",
    });
    const runNew = repos.runs.create({
      projectId: withOpen.id,
      agentId: agentB.id,
      idempotencyKey: "new",
      trigger: "manual",
    });
    const runMerged = repos.runs.create({
      projectId: withOpen.id,
      agentId: agentA.id,
      idempotencyKey: "merged",
      trigger: "manual",
    });
    const runOther = repos.runs.create({
      projectId: without.id,
      agentId: agentC.id,
      idempotencyKey: "other",
      trigger: "manual",
    });

    repos.attempts.create({
      runId: runNew.id,
      attemptNumber: 1,
      branchName: "gojo/maintain-docs/branch",
    });

    repos.runIntegrations.upsertForRun({
      runId: runOld.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/a",
      prNumber: 1,
      prUrl: "https://github.com/me/a/pull/1",
      status: "open",
      openedAt: "2026-07-01T00:00:00.000Z",
      nextCheckAt: "2026-07-27T20:00:00.000Z",
    });
    repos.runIntegrations.upsertForRun({
      runId: runNew.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/a",
      prNumber: 2,
      prUrl: "https://github.com/me/a/pull/2",
      status: "open",
      openedAt: "2026-07-10T00:00:00.000Z",
      nextCheckAt: "2026-07-27T20:00:00.000Z",
    });
    repos.runIntegrations.upsertForRun({
      runId: runMerged.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/a",
      prNumber: 3,
      prUrl: "https://github.com/me/a/pull/3",
      status: "merged",
      openedAt: "2026-07-05T00:00:00.000Z",
      mergedAt: "2026-07-06T00:00:00.000Z",
    });
    repos.runIntegrations.upsertForRun({
      runId: runOther.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/b",
      prNumber: 9,
      prUrl: "https://github.com/me/b/pull/9",
      status: "closed",
      openedAt: "2026-07-02T00:00:00.000Z",
      closedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(projectSummaryFor(db, withOpen.id)?.openPrCount).toBe(2);
    expect(projectSummaryFor(db, without.id)?.openPrCount).toBe(0);

    const allOpen = listIntegrationsPage(db, { limit: 25, offset: 0, status: "open" });
    expect(allOpen.total).toBe(2);
    expect(allOpen.items.map((row) => row.prNumber)).toEqual([2, 1]);
    expect(allOpen.items[0]?.branchName).toBe("gojo/maintain-docs/branch");
    expect(allOpen.items[0]?.projectName).toBe("with-open");
    expect(allOpen.items[0]?.agentName).toBe("maintain-docs");
    expect(allOpen.items[0]?.mergedAt).toBeNull();

    const filtered = listIntegrationsPage(db, {
      limit: 25,
      offset: 0,
      status: "open",
      projectId: withOpen.id,
    });
    expect(filtered.total).toBe(2);

    const page = listIntegrationsPage(db, {
      limit: 1,
      offset: 0,
      status: "open",
      sort: "openedAt",
      order: "asc",
    });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.prNumber).toBe(1);

    const merged = listIntegrationsPage(db, { limit: 25, offset: 0, status: "merged" });
    expect(merged.total).toBe(1);
    expect(merged.items[0]?.prNumber).toBe(3);
    expect(merged.items[0]?.mergedAt).toBe("2026-07-06T00:00:00.000Z");
    expect(merged.items[0]?.status).toBe("merged");

    const withPrs = listProjectsPage(db, { limit: 25, offset: 0, hasOpenPrs: true });
    expect(withPrs.total).toBe(1);
    expect(withPrs.items[0]?.id).toBe(withOpen.id);
    expect(withPrs.items[0]?.openPrCount).toBe(2);

    db.close();
  });

  test("listIntegrationsPage lists committed by commit_sha and supports from/to", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "alpha", repoPath: "/tmp/a" });
    const agent = repos.agents.create({ projectId: project.id, name: "deps", prompt: "x" });

    const commitRun = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "commit",
      trigger: "manual",
    });
    const prRun = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "pr",
      trigger: "manual",
    });
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2026-07-10T00:00:00.000Z", commitRun.id);
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", prRun.id);

    repos.runIntegrations.upsertForRun({
      runId: commitRun.id,
      mode: "commit-only",
      status: "committed",
      commitSha: "abc123",
    });
    repos.runIntegrations.upsertForRun({
      runId: prRun.id,
      mode: "pull-request",
      prNumber: 1,
      prUrl: "https://example.com/1",
      status: "open",
      openedAt: "2026-01-01T00:00:00.000Z",
      nextCheckAt: "2026-07-27T20:00:00.000Z",
    });

    const committed = listIntegrationsPage(db, { limit: 25, offset: 0, status: "committed" });
    expect(committed.total).toBe(1);
    expect(committed.items[0]?.commitSha).toBe("abc123");
    expect(committed.items[0]?.prNumber).toBeNull();

    const windowed = listIntegrationsPage(db, {
      limit: 25,
      offset: 0,
      status: "committed",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.999Z",
    });
    expect(windowed.total).toBe(1);

    const emptyWindow = listIntegrationsPage(db, {
      limit: 25,
      offset: 0,
      status: "committed",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
    });
    expect(emptyWindow.total).toBe(0);

    db.close();
  });

  test("listRunsPage filters by from/to on created_at", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const agent = repos.agents.create({ projectId: project.id, name: "t", prompt: "x" });
    const inRange = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "in",
      trigger: "manual",
      state: RunState.Succeeded,
    });
    const out = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "out",
      trigger: "manual",
      state: RunState.Succeeded,
    });
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2026-07-10T00:00:00.000Z", inRange.id);
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", out.id);

    const page = listRunsPage(db, {
      limit: 25,
      offset: 0,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.999Z",
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(inRange.id);
    db.close();
  });

  test("listImpactItemsPage filters by category, excludes rejected, pages", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "alpha", repoPath: "/tmp/a" });
    const agent = repos.agents.create({ projectId: project.id, name: "deps", prompt: "x" });
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "k1",
      trigger: "manual",
    });
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2026-07-10T00:00:00.000Z", run.id);

    repos.runImpactItems.replaceForRun(run.id, null, [
      {
        category: "dependency-update",
        subject: "package.json",
        summary: "deps",
        source: "platform",
        verification: "verified",
      },
      {
        category: "dependency-update",
        subject: "croner",
        summary: "bump",
        source: "agent",
        verification: "corroborated",
      },
      {
        category: "documentation",
        subject: "docs/a.md",
        summary: "docs",
        source: "platform",
        verification: "verified",
      },
      {
        category: "security",
        subject: "bogus",
        summary: "nope",
        source: "agent",
        verification: "rejected",
      },
    ]);

    const deps = listImpactItemsPage(db, {
      limit: 25,
      offset: 0,
      category: "dependency-update",
    });
    expect(deps.total).toBe(2);
    expect(deps.items.every((item) => item.category === "dependency-update")).toBe(true);
    expect(deps.items[0]?.projectName).toBe("alpha");
    expect(deps.items[0]?.agentName).toBe("deps");

    const page = listImpactItemsPage(db, {
      limit: 1,
      offset: 0,
      category: "dependency-update",
    });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);

    const all = listImpactItemsPage(db, { limit: 25, offset: 0 });
    expect(all.total).toBe(3);

    const windowed = listImpactItemsPage(db, {
      limit: 25,
      offset: 0,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.999Z",
    });
    expect(windowed.total).toBe(3);

    db.close();
  });
});
