/**
 * Behavior lock: CLI command characterization.
 * Do not weaken assertions during architecture refactor phases — keep green by preserving behavior.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commitAll, configLocal, initRepo } from "@/infrastructure/git/git";
import { Database } from "@/infrastructure/persistence";
import { resolvePaths } from "@/platform/config/paths";

import { createCliHarness, type CliHarness } from "../support/cli-harness";

describe("contract/cli/commands", () => {
  let harness: CliHarness | null = null;

  afterEach(() => {
    harness?.dispose();
    harness = null;
  });

  function boot(): CliHarness {
    harness = createCliHarness();
    return harness;
  }

  test("setup creates admin; second setup conflicts", async () => {
    const h = boot();
    const first = await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);
    expect(first.exitCode).toBe(0);
    expect(first.json).toMatchObject({
      user: { username: "admin", role: "admin" },
    });

    const second = await h.run(["setup", "--username", "other", "--password", "secret-pass"]);
    expect(second.exitCode).toBe(3); // ExitCode.Conflict
    expect(second.stderr).toContain("Setup already completed");
  });

  test("setup without credentials is usage error", async () => {
    const h = boot();
    const result = await h.run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("setup requires --username and --password");
  });

  test("auth whoami and password after setup", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);

    const whoami = await h.run(["auth", "whoami"]);
    expect(whoami.exitCode).toBe(0);
    expect(whoami.json).toMatchObject({
      users: [{ username: "admin", role: "admin" }],
    });

    const password = await h.run([
      "auth",
      "password",
      "--current-password",
      "secret-pass",
      "--new-password",
      "new-secret-99",
    ]);
    expect(password.exitCode).toBe(0);
    expect(password.json).toMatchObject({ ok: true, username: "admin" });
  });

  test("adapter list/detect/inspect/test", async () => {
    const h = boot();
    const list = await h.run(["adapter", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.json).toMatchObject({ adapters: expect.arrayContaining(["shell"]) });

    const detect = await h.run(["adapter", "detect"]);
    expect(detect.exitCode).toBe(0);
    const detected = detect.json as { adapters: Array<{ name: string; installed: boolean }> };
    expect(detected.adapters.some((a) => a.name === "shell" && a.installed)).toBe(true);

    const inspect = await h.run(["adapter", "inspect", "shell"]);
    expect(inspect.exitCode).toBe(0);
    expect(inspect.json).toMatchObject({ name: "shell", installed: true });

    const missing = await h.run(["adapter", "inspect", "no-such-adapter"]);
    expect(missing.exitCode).toBe(2);

    const testRun = await h.run(["adapter", "test", "shell"]);
    expect(testRun.exitCode).toBe(0);
    expect(testRun.json).toMatchObject({ exitCode: 0, timedOut: false });
  });

  test("project add/list/inspect and empty lists for agent/schedule/run", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);

    const repoPath = join(h.home, "repo");
    mkdirSync(repoPath, { recursive: true });
    await initRepo(repoPath);
    await configLocal(repoPath, "user.email", "test@example.com");
    await configLocal(repoPath, "user.name", "Gojo Test");
    writeFileSync(join(repoPath, "README.md"), "# contract cli\n");
    await commitAll(repoPath, "initial");

    const add = await h.run(["project", "add", "demo", repoPath]);
    expect(add.exitCode).toBe(0);
    const project = (add.json as { project: { id: string; name: string } }).project;
    expect(project.name).toBe("demo");

    const list = await h.run(["project", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.json).toMatchObject({
      projects: [{ id: project.id, name: "demo" }],
    });

    const inspect = await h.run(["project", "inspect", project.id]);
    expect(inspect.exitCode).toBe(0);
    expect(inspect.json).toMatchObject({ project: { id: project.id } });

    const missing = await h.run(["project", "inspect", "01MISSINGPROJECTID000000000"]);
    expect(missing.exitCode).toBe(2);

    const agents = await h.run(["agent", "list", "--project", project.id]);
    expect(agents.exitCode).toBe(0);
    expect(agents.json).toMatchObject({ agents: [] });

    const schedules = await h.run(["schedule", "list"]);
    expect(schedules.exitCode).toBe(0);
    expect(schedules.json).toMatchObject({ schedules: [] });

    const runs = await h.run(["run", "list"]);
    expect(runs.exitCode).toBe(0);
    expect(runs.json).toMatchObject({ runs: [] });
  });

  test("project sync + agent enable/disable emit platform events via unified use case", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);

    const repoPath = join(h.home, "repo");
    mkdirSync(join(repoPath, ".gojo", "agents"), { recursive: true });
    await initRepo(repoPath);
    await configLocal(repoPath, "user.email", "test@example.com");
    await configLocal(repoPath, "user.name", "Gojo Test");
    writeFileSync(join(repoPath, "README.md"), "# sync\n");
    writeFileSync(
      join(repoPath, "gojo.yaml"),
      [
        "version: 1",
        "project:",
        "  name: demo",
        "  defaultBranch: main",
        "repository:",
        "  remote: origin",
        "  syncBeforeRun: true",
        "  requireCleanBase: true",
        "  submodules: false",
        "  gitLfs: false",
        "profiles:",
        "  shell:",
        "    adapter: shell",
        "    timeout: 5m",
        "validationProfiles:",
        "  ok:",
        "    steps:",
        "      - name: ok",
        "        command: 'true'",
        "        timeout: 30s",
        "agents:",
        "  hello:",
        "    description: Hello agent",
        "    profile: shell",
        "    promptFile: .gojo/agents/hello.sh",
        "    validationProfile: ok",
        "    integration:",
        "      mode: commit-only",
        "      targetBranch: main",
        "      commitMessage: 'gojo: hello'",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repoPath, ".gojo/agents/hello.sh"),
      "#!/bin/sh\nset -eu\necho hello > hello.txt\n",
    );
    await commitAll(repoPath, "initial");

    const add = await h.run(["project", "add", "demo", repoPath]);
    const projectId = (add.json as { project: { id: string } }).project.id;

    const sync = await h.run(["project", "sync", projectId]);
    expect(sync.exitCode).toBe(0);
    expect(sync.json).toMatchObject({
      sync: {
        agents: 1,
        profiles: 1,
      },
    });

    const agents = await h.run(["agent", "list", "--project", projectId]);
    expect(agents.exitCode).toBe(0);
    const agentList = (agents.json as { agents: Array<{ id: string; enabled: boolean; name: string }> })
      .agents;
    expect(agentList.length).toBe(1);
    const agentId = agentList[0]!.id;

    const disable = await h.run(["agent", "disable", agentId]);
    expect(disable.exitCode).toBe(0);
    expect(disable.json).toMatchObject({ agent: { id: agentId, enabled: false } });

    const enable = await h.run(["agent", "enable", agentId]);
    expect(enable.exitCode).toBe(0);
    expect(enable.json).toMatchObject({ agent: { id: agentId, enabled: true } });

    // CLI and API now share the same catalog use cases and emit platform events once.
    // We expect one event per disable and one per enable, matching what the API would emit.
    const paths = resolvePaths(h.home);
    const db = Database.open(paths.db);
    try {
      const agentUpdated =
        db
          .connection()
          .query<{ n: number }, []>(
            `SELECT COUNT(*) AS n FROM platform_change_events
             WHERE type = 'agent.updated'`,
          )
          .get()?.n ?? 0;
      expect(agentUpdated).toBeGreaterThanOrEqual(2);

      const projectSynced =
        db
          .connection()
          .query<{ n: number }, []>(
            `SELECT COUNT(*) AS n FROM platform_change_events
             WHERE type = 'project.synced'`,
          )
          .get()?.n ?? 0;
      expect(projectSynced).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });

  test("instance show and server doctor", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);

    const show = await h.run(["instance", "show"]);
    expect(show.exitCode).toBe(0);
    expect(show.json).toMatchObject({
      bindHost: expect.any(String),
      bindPort: expect.any(Number),
      paused: false,
    });

    const doctor = await h.run(["server", "doctor"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json).toBeTruthy();
  });

  test("instance scheduling-show/set via use-case registry", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);

    const show = await h.run(["instance", "scheduling-show"]);
    expect(show.exitCode).toBe(0);
    expect(show.json).toMatchObject({
      policy: { maxConcurrentRuns: expect.any(Number) },
    });

    const set = await h.run([
      "instance",
      "scheduling-set",
      "--max-concurrent-runs",
      "4",
      "--max-concurrent-per-project",
      "2",
      "--min-start-interval-ms",
      "0",
      "--max-load-per-cpu",
      "0",
    ]);
    expect(set.exitCode).toBe(0);
    expect(set.json).toMatchObject({
      policy: { maxConcurrentRuns: 4, maxConcurrentRunsPerProject: 2 },
    });
  });

  test("backup create; approval list; integration list --open", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);

    const backup = await h.run(["backup", "create"]);
    expect(backup.exitCode).toBe(0);

    const approvals = await h.run(["approval", "list"]);
    expect(approvals.exitCode).toBe(0);

    const integrations = await h.run(["integration", "list", "--open"]);
    expect(integrations.exitCode).toBe(0);
  });

  test("unknown command group is usage error", async () => {
    const h = boot();
    const result = await h.run(["not-a-real-group"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command group");
  });

  test("work-status with no subcommand prints group help", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);
    const result = await h.run(["work-status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Rebuild work status rollups");
    expect(result.stdout).toContain("rebuild");
  });

  test("work-status with unknown subcommand is usage error", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);
    const result = await h.run(["work-status", "nope"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("work-status rebuild");
  });

  test("work-status rebuild succeeds", async () => {
    const h = boot();
    await h.run(["setup", "--username", "admin", "--password", "secret-pass"]);
    const result = await h.run(["work-status", "rebuild"]);
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({ rebuilt: true });
  });
});
