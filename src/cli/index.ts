#!/usr/bin/env bun

import { createAppContext } from "@/app/context";
import { computeScheduleNextRun } from "@/app/context";
import { syncProjectFromManifest } from "@/app/project-sync";
import { checkHealth, readPidFile, startServer, stopServerByPid } from "@/api/server";
import { listAdapters } from "@/agents";
import { UserService } from "@/auth/users";
import { createBackup, restoreBackup, verifyBackup } from "@/backup/backup";
import { defaultBackupDest } from "@/backup/list";
import { resolvePaths } from "@/config/paths";
import { instanceDoctor, projectDoctor } from "@/diagnostics/doctor";
import { getRunArtifacts, getRunDiff } from "@/runs/inspect";
import { ensureProjectRepositorySource } from "@/sources";
import { getTaskDetail, listIntegrationsPage } from "@/storage/paged-lists";
import { DEFAULT_PAGE_LIMIT } from "@shared/pagination";
import {
  installService,
  resolveServiceLaunch,
  serviceControl,
  uninstallService,
} from "@/service/install";

import {
  getFlagString,
  getHome,
  getOutputFormat,
  hasFlag,
  parseArgv,
  type ParsedArgv,
} from "./parse";
import { die, printOutput } from "./output";

async function withContext(home: string | undefined, fn: (ctx: Awaited<ReturnType<typeof createAppContext>>) => Promise<void>): Promise<void> {
  const ctx = await createAppContext(home);
  try {
    await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function runServerStart(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const home = getHome(parsed);
  const foreground = !hasFlag(parsed, "daemon");
  const ctx = await createAppContext(home);
  const server = await startServer({ ctx, writePid: true });

  printOutput(format, {
    status: "started",
    url: server.url,
    pid: process.pid,
    foreground,
  });

  if (!foreground) {
    return;
  }

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      // Never hang forever on dispose (scheduler/DB/open requests).
      const forceTimer = setTimeout(() => {
        process.exit(0);
      }, 3_000);
      forceTimer.unref?.();

      try {
        server.stop();
        await ctx.dispose();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            level: "error",
            component: "server",
            event: "shutdown_failed",
            error: message,
          }),
        );
      } finally {
        clearTimeout(forceTimer);
        resolve();
        process.exit(0);
      }
    };
    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });
  });
}

async function runServerStatus(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const home = getHome(parsed) ?? resolvePaths().home;
  const pid = readPidFile(home);
  const baseUrl = `http://127.0.0.1:7430`;
  const healthy = await checkHealth(baseUrl);

  printOutput(format, {
    home,
    pid,
    healthy,
    url: baseUrl,
  });
}

async function runServerStop(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const home = getHome(parsed) ?? resolvePaths().home;
  const stopped = await stopServerByPid(home);
  printOutput(format, { stopped, home });
}

async function runServerDoctor(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const home = getHome(parsed);
  await withContext(home, async (ctx) => {
    printOutput(format, await instanceDoctor(ctx));
  });
}

async function runSetup(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const username = getFlagString(parsed, "username");
  const password = getFlagString(parsed, "password");
  if (!username || !password) {
    die("setup requires --username and --password", format);
  }

  await withContext(getHome(parsed), async (ctx) => {
    const users = new UserService(ctx.db);
    if (users.countUsers() > 0) {
      die("setup already completed", format);
    }
    const user = await users.createUser(username, password, "admin");
    printOutput(format, { user: { id: user.id, username: user.username, role: user.role } });
  });
}

async function runProjectCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    switch (sub) {
      case "add": {
        const name = parsed.positional[0];
        const repoPath = parsed.positional[1];
        if (!name || !repoPath) {
          die("usage: gojo project add <name> <repoPath>", format);
        }
        const remote = getFlagString(parsed, "remote");
        const branch = getFlagString(parsed, "branch");
        const project = ctx.repos.projects.create({
          name,
          repoPath,
          ...(branch ? { defaultBranch: branch } : {}),
          ...(remote !== undefined ? { remoteUrl: remote } : {}),
        });
        ensureProjectRepositorySource(ctx.db, project.id);
        ctx.platformEvents.append({
          projectId: project.id,
          type: "project.created",
          entityKind: "project",
          entityId: project.id,
          topics: ["dashboard", "overview", "projects", "sources"],
        });
        printOutput(format, { project });
        break;
      }
      case "list": {
        printOutput(format, { projects: ctx.repos.projects.list() });
        break;
      }
      case "inspect": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project inspect <id>", format);
        }
        const project = ctx.repos.projects.findById(id);
        if (!project) {
          die("project not found", format);
        }
        printOutput(format, { project });
        break;
      }
      case "sync": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project sync <id>", format);
        }
        const project = ctx.repos.projects.findById(id);
        if (!project) {
          die("project not found", format);
        }
        const sync = syncProjectFromManifest(ctx.repos, project);
        ensureProjectRepositorySource(ctx.db, project.id);
        ctx.platformEvents.append({
          projectId: project.id,
          type: "project.synced",
          entityKind: "project",
          entityId: project.id,
          topics: [
            "dashboard",
            "overview",
            "projects",
            "tasks",
            "schedules",
            "work",
            "sources",
          ],
          data: sync,
        });
        printOutput(format, { sync });
        break;
      }
      case "doctor": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project doctor <id>", format);
        }
        const project = ctx.repos.projects.findById(id);
        if (!project) {
          die("project not found", format);
        }
        printOutput(format, await projectDoctor(project, ctx.repos));
        break;
      }
      case "work": {
        const id = parsed.positional[0];
        if (!id) die("usage: gojo project work <id>", format);
        const result = ctx.work.items.listByProject(id, {
          limit: DEFAULT_PAGE_LIMIT,
          offset: 0,
          kind: getFlagString(parsed, "kind") ?? null,
          provenance:
            (getFlagString(parsed, "provenance") as
              | "gojo-agent"
              | "human"
              | "bot"
              | "external"
              | undefined) ?? null,
          delivery:
            (getFlagString(parsed, "delivery") as
              | "none"
              | "draft"
              | "open"
              | "review"
              | "blocked"
              | "merged"
              | "closed"
              | undefined) ?? null,
          attention:
            (getFlagString(parsed, "attention") as
              | "none"
              | "approval"
              | "blocked"
              | "sync-error"
              | "stale"
              | undefined) ?? null,
          history: hasFlag(parsed, "history"),
        });
        printOutput(format, result);
        break;
      }
      case "status": {
        const id = parsed.positional[0];
        if (!id) die("usage: gojo project status <id>", format);
        printOutput(format, ctx.work.items.status(id));
        break;
      }
      case "sources": {
        const id = parsed.positional[0];
        if (!id) die("usage: gojo project sources <id>", format);
        printOutput(format, { sources: ctx.work.sources.listByProject(id) });
        break;
      }
      case "refresh-source": {
        const id = parsed.positional[0];
        const sourceId = parsed.positional[1];
        if (!id || !sourceId) {
          die("usage: gojo project refresh-source <id> <sourceId>", format);
        }
        const source = ctx.work.sources.findById(sourceId);
        if (!source || source.projectId !== id) die("project source not found", format);
        printOutput(format, { sync: await ctx.sourceSync.syncSource(sourceId) });
        break;
      }
      case "recheck-work": {
        const id = parsed.positional[0];
        const workItemId = parsed.positional[1];
        if (!id || !workItemId) {
          die("usage: gojo project recheck-work <id> <workItemId>", format);
        }
        const work = ctx.work.items.findById(workItemId);
        if (!work || work.projectId !== id) die("work item not found", format);
        printOutput(format, { result: await ctx.sourceSync.recheckWorkItem(workItemId) });
        break;
      }
      case "resolve-work": {
        const id = parsed.positional[0];
        const workItemId = parsed.positional[1];
        if (!id || !workItemId) {
          die("usage: gojo project resolve-work <id> <workItemId>", format);
        }
        const work = ctx.work.items.findById(workItemId);
        if (!work || work.projectId !== id) die("work item not found", format);
        printOutput(format, {
          work: ctx.sourceSync.resolveWorkItem(workItemId, {
            resolvedBy: getFlagString(parsed, "by") ?? "cli",
            note: getFlagString(parsed, "note") ?? null,
          }),
        });
        break;
      }
      case "remove": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project remove <id>", format);
        }
        const removed = ctx.repos.projects.delete(id);
        printOutput(format, { removed });
        break;
      }
      default:
        die(`unknown project command: ${sub ?? ""}`, format);
    }
  });
}

async function runAgentCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  const adapters = listAdapters();

  switch (sub) {
    case "list": {
      printOutput(format, { agents: adapters.map((adapter) => adapter.name) });
      break;
    }
    case "detect": {
      const detected = await Promise.all(
        adapters.map(async (adapter) => ({
          name: adapter.name,
          ...(await adapter.detect()),
        })),
      );
      printOutput(format, { agents: detected });
      break;
    }
    case "inspect": {
      const name = parsed.positional[0];
      const adapter = adapters.find((item) => item.name === name);
      if (!adapter) {
        die("agent not found", format);
      }
      printOutput(format, { name: adapter.name, ...(await adapter.detect()) });
      break;
    }
    case "test": {
      const name = parsed.positional[0] ?? "shell";
      const adapter = adapters.find((item) => item.name === name);
      if (!adapter) {
        die("agent not found", format);
      }
      const result = await adapter.execute({
        workspacePath: process.cwd(),
        prompt: "#!/bin/sh\necho gojo-agent-test",
        env: {},
        timeoutMs: 10_000,
        signal: AbortSignal.timeout(10_000),
      });
      printOutput(format, result);
      break;
    }
    default:
      die(`unknown agent command: ${sub ?? ""}`, format);
  }
}

async function runTaskCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    switch (sub) {
      case "list": {
        const projectId = getFlagString(parsed, "project") ?? parsed.positional[0];
        if (!projectId) {
          die("usage: gojo task list --project <id>", format);
        }
        printOutput(format, { tasks: ctx.repos.tasks.listByProject(projectId) });
        break;
      }
      case "inspect": {
        const taskId = parsed.positional[0];
        if (!taskId) {
          die("usage: gojo task inspect <taskId>", format);
        }
        const task = getTaskDetail(ctx.db, taskId);
        if (!task) {
          die("task not found", format);
        }
        printOutput(format, { task });
        break;
      }
      case "run": {
        const taskId = parsed.positional[0];
        if (!taskId) {
          die("usage: gojo task run <taskId>", format);
        }
        const task = ctx.repos.tasks.findById(taskId);
        if (!task) {
          die("task not found", format);
        }
        const run = await ctx.coordinator.enqueueRun({
          projectId: task.projectId,
          taskId: task.id,
          trigger: "manual",
        });
        if (format === "text") {
          process.stderr.write(`queued ${run.id}; waiting for admission slot…\n`);
        }
        await ctx.dispatcher.waitForTerminal(run.id);
        const finished = ctx.repos.runs.findById(run.id);
        printOutput(format, { run: finished });
        break;
      }
      case "enable": {
        const taskId = parsed.positional[0];
        if (!taskId) {
          die("usage: gojo task enable <taskId>", format);
        }
        if (!ctx.repos.tasks.findById(taskId)) {
          die("task not found", format);
        }
        printOutput(format, { task: ctx.repos.tasks.update(taskId, { enabled: true }) });
        break;
      }
      case "disable": {
        const taskId = parsed.positional[0];
        if (!taskId) {
          die("usage: gojo task disable <taskId>", format);
        }
        if (!ctx.repos.tasks.findById(taskId)) {
          die("task not found", format);
        }
        printOutput(format, { task: ctx.repos.tasks.update(taskId, { enabled: false }) });
        break;
      }
      case "cancel": {
        const runId = parsed.positional[0];
        if (!runId) {
          die("usage: gojo task cancel <runId>", format);
        }
        await ctx.coordinator.cancelRun(runId);
        printOutput(format, { run: ctx.repos.runs.findById(runId) });
        break;
      }
      case "retry": {
        const runId = parsed.positional[0];
        if (!runId) {
          die("usage: gojo task retry <runId>", format);
        }
        const existing = ctx.repos.runs.findById(runId);
        if (!existing) {
          die("run not found", format);
        }
        const run = await ctx.coordinator.enqueueRun({
          projectId: existing.projectId,
          taskId: existing.taskId,
          trigger: "manual",
        });
        if (format === "text") {
          process.stderr.write(`queued ${run.id}; waiting for admission slot…\n`);
        }
        await ctx.dispatcher.waitForTerminal(run.id);
        const finished = ctx.repos.runs.findById(run.id);
        printOutput(format, { run: finished });
        break;
      }
      default:
        die(`unknown task command: ${sub ?? ""}`, format);
    }
  });
}

async function runScheduleCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    const listAll = () =>
      ctx.db
        .connection()
        .query("SELECT * FROM schedules ORDER BY created_at")
        .all();

    switch (sub) {
      case "list": {
        printOutput(format, { schedules: listAll() });
        break;
      }
      case "enable": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo schedule enable <id>", format);
        }
        const schedule = ctx.repos.schedules.findById(id);
        if (!schedule) {
          die("schedule not found", format);
        }
        const nextRunAt = computeScheduleNextRun(schedule.cronExpr, schedule.timezone);
        printOutput(format, {
          schedule: ctx.repos.schedules.update(id, { enabled: true, nextRunAt }),
        });
        break;
      }
      case "disable":
      case "pause": {
        const id = parsed.positional[0];
        if (!id) {
          die(`usage: gojo schedule ${sub} <id>`, format);
        }
        printOutput(format, { schedule: ctx.repos.schedules.update(id, { enabled: false }) });
        break;
      }
      case "next": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo schedule next <id>", format);
        }
        const schedule = ctx.repos.schedules.findById(id);
        if (!schedule) {
          die("schedule not found", format);
        }
        printOutput(format, {
          scheduleId: id,
          nextRunAt: computeScheduleNextRun(schedule.cronExpr, schedule.timezone),
        });
        break;
      }
      default:
        die(`unknown schedule command: ${sub ?? ""}`, format);
    }
  });
}

async function runRunCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    switch (sub) {
      case "list": {
        const projectId = getFlagString(parsed, "project");
        const runs =
          projectId && projectId.length > 0
            ? ctx.repos.runs.listByProject(projectId)
            : ctx.repos.runs.listAll();
        printOutput(format, { runs });
        break;
      }
      case "inspect": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo run inspect <id>", format);
        }
        const run = ctx.repos.runs.findById(id);
        if (!run) {
          die("run not found", format);
        }
        printOutput(format, { run, attempts: ctx.repos.attempts.listByRun(id) });
        break;
      }
      case "logs": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo run logs <id>", format);
        }
        printOutput(format, { events: ctx.eventHistory.list(id) });
        break;
      }
      case "diff": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo run diff <id>", format);
        }
        try {
          printOutput(format, await getRunDiff(ctx, id));
        } catch (error) {
          die(error instanceof Error ? error.message : String(error), format);
        }
        break;
      }
      case "approve": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo run approve <id>", format);
        }
        await ctx.coordinator.approveRun(id);
        printOutput(format, { run: ctx.repos.runs.findById(id) });
        break;
      }
      case "reject": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo run reject <id>", format);
        }
        await ctx.coordinator.rejectRun(id, getFlagString(parsed, "reason"));
        printOutput(format, { run: ctx.repos.runs.findById(id) });
        break;
      }
      case "artifacts": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo run artifacts <id>", format);
        }
        printOutput(format, getRunArtifacts(ctx, id));
        break;
      }
      default:
        die(`unknown run command: ${sub ?? ""}`, format);
    }
  });
}

async function runBackupCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  const home = getHome(parsed);
  const paths = resolvePaths(home);

  switch (sub) {
    case "create": {
      const dest = parsed.positional[0] ?? defaultBackupDest(paths);
      const result = await createBackup(paths, paths.db, dest);
      printOutput(format, result);
      break;
    }
    case "verify": {
      const path = parsed.positional[0];
      if (!path) {
        die("usage: gojo backup verify <path>", format);
      }
      printOutput(format, { valid: await verifyBackup(path) });
      break;
    }
    case "restore": {
      const path = parsed.positional[0];
      if (!path) {
        die("usage: gojo backup restore <path>", format);
      }
      await restoreBackup(path, paths.home);
      printOutput(format, { restored: true, home: paths.home });
      break;
    }
    default:
      die(`unknown backup command: ${sub ?? ""}`, format);
  }
}

async function runServiceCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  const home = getHome(parsed) ?? resolvePaths().home;
  // import.meta.path here is the CLI entry (compiled as /$bunfs/... or source .ts path)
  const launch = resolveServiceLaunch(home, import.meta.path);

  switch (sub) {
    case "install": {
      const result = installService({ home, execPath: launch.execPath, args: launch.args });
      const reload = serviceControl("daemon-reload");
      const reloadProc = Bun.spawn(reload, { stdout: "inherit", stderr: "inherit" });
      await reloadProc.exited;
      printOutput(format, {
        ...result,
        execStart: [launch.execPath, ...launch.args].join(" "),
        daemonReload: reload.join(" "),
      });
      break;
    }
    case "uninstall": {
      printOutput(format, uninstallService());
      break;
    }
    case "start":
    case "stop":
    case "restart":
    case "status":
    case "logs": {
      const cmd = serviceControl(sub);
      const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
      await proc.exited;
      printOutput(format, { command: cmd.join(" "), exitCode: proc.exitCode });
      break;
    }
    default:
      die(`unknown service command: ${sub ?? ""}`, format);
  }
}

function printHelp(): void {
  console.log(`gojo — scheduled software-agent orchestration

Usage:
  gojo [--home <path>] [--output json|text|yaml] <command> ...

Commands:
  setup                         Create admin user
  server start|status|stop|doctor
  service install|uninstall|start|stop|restart|status|logs
  project add|list|inspect|sync|doctor|work|status|sources|refresh-source|remove
  agent detect|list|inspect|test
  task list|inspect|run|enable|disable|cancel|retry
  schedule list|enable|disable|pause|next
  run list|inspect|logs|diff|approve|reject|artifacts
  integration list --open|--merged [--project <id>]
  backup create|verify|restore
`);
}

async function runIntegrationCommand(
  parsed: ParsedArgv,
  format: ReturnType<typeof getOutputFormat>,
): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    switch (sub) {
      case "list": {
        const wantOpen = hasFlag(parsed, "open");
        const wantMerged = hasFlag(parsed, "merged");
        if (wantOpen === wantMerged) {
          die("usage: gojo integration list --open|--merged [--project <id>]", format);
        }
        const projectId = getFlagString(parsed, "project");
        const result = listIntegrationsPage(ctx.db, {
          limit: DEFAULT_PAGE_LIMIT,
          offset: 0,
          status: wantOpen ? "open" : "merged",
          ...(projectId ? { projectId } : {}),
        });
        printOutput(format, {
          integrations: result.items,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        });
        break;
      }
      default:
        die(`unknown integration command: ${sub ?? ""}`, format);
    }
  });
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);
  const format = getOutputFormat(parsed);

  if (hasFlag(parsed, "help") || parsed.command.length === 0) {
    printHelp();
    return;
  }

  const [group, sub] = parsed.command;
  if (!group) {
    printHelp();
    return;
  }

  try {
    if (group === "setup") {
      await runSetup(parsed, format);
      return;
    }

    if (group === "server") {
      switch (sub) {
        case "start":
          await runServerStart(parsed, format);
          return;
        case "status":
          await runServerStatus(parsed, format);
          return;
        case "stop":
          await runServerStop(parsed, format);
          return;
        case "doctor":
          await runServerDoctor(parsed, format);
          return;
        default:
          die(`unknown server command: ${sub ?? ""}`, format);
      }
    }

    if (group === "service") {
      await runServiceCommand(parsed, format);
      return;
    }

    if (group === "project") {
      await runProjectCommand(parsed, format);
      return;
    }

    if (group === "agent") {
      await runAgentCommand(parsed, format);
      return;
    }

    if (group === "task") {
      await runTaskCommand(parsed, format);
      return;
    }

    if (group === "schedule") {
      await runScheduleCommand(parsed, format);
      return;
    }

    if (group === "run") {
      await runRunCommand(parsed, format);
      return;
    }

    if (group === "integration") {
      await runIntegrationCommand(parsed, format);
      return;
    }

    if (group === "backup") {
      await runBackupCommand(parsed, format);
      return;
    }

    if (group === "work-status") {
      if (sub !== "rebuild") {
        die("usage: gojo work-status rebuild [--project <id>] [--from <iso>]", format);
      }
      await withContext(getHome(parsed), async (ctx) => {
        const projectId = getFlagString(parsed, "project");
        const from = getFlagString(parsed, "from");
        const deleted = ctx.work.rollup.rebuild({
          ...(projectId ? { projectId } : {}),
          ...(from ? { from } : {}),
        });
        printOutput(format, { rebuilt: true, deleted });
      });
      return;
    }

    die(`unknown command group: ${group}`, format);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    die(message, format);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
