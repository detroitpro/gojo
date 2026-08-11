#!/usr/bin/env bun

import { createAppContext } from "@/platform/app-context";
import { computeScheduleNextRun } from "@/platform/app-context";
import { checkHealth, readPidFile, startServer, stopServerByPid } from "@/transports/http/server";
import { listAdapters } from "@/infrastructure/agent-adapters";
import { UserService } from "@/contexts/access/infrastructure/auth/users";
import { createBackup, restoreBackup, verifyBackup } from "@/contexts/operations/infrastructure/backup/backup";
import { defaultBackupDest } from "@/contexts/operations/infrastructure/backup/list";
import {
  normalizePublicBaseUrl,
  resolveApiBaseUrl,
  type CookieSecureMode,
} from "@/platform/config/instance";
import { resolvePaths } from "@/platform/config/paths";
import { instanceDoctor, projectDoctor } from "@/contexts/operations/infrastructure/diagnostics/doctor";
import { getRunArtifacts, getRunDiff } from "@/contexts/execution/contract";
import { ensureProjectRepositorySource } from "@/contexts/work/infrastructure/source-sync";
import { getAgentDetail } from "@/contexts/catalog/infrastructure/catalog-paged-lists";
import { listIntegrationsPage } from "@/contexts/delivery/infrastructure/integration-paged-lists";
import { migrateProjectVocab, type MigrateVocabResult } from "@/contexts/catalog/infrastructure/migrate-vocab";
import { DEFAULT_PAGE_LIMIT } from "@shared/pagination";
import { ApprovalStateSchema } from "@shared/approvals";
import {
  installService,
  resolveServiceLaunch,
  serviceControl,
  uninstallService,
} from "@/contexts/operations/infrastructure/service/install";

import { getUseCaseRegistry, tryDispatchCliUseCase } from "@/platform";

import { ExitCode } from "./errors";
import {
  findCommandHelp,
  findGroup,
  printCommandHelp,
  printGroupHelp,
  printOverviewHelp,
  suggestCommands,
} from "./help";
import {
  getFlagString,
  getHome,
  getOutputFormat,
  hasFlag,
  parseArgv,
  type OutputFormat,
  type ParsedArgv,
} from "./parse";
import { isInteractive, promptLine, promptSecret } from "./prompt";
import { die, printOutput, printSection, printSuccess } from "./output";
import { style } from "./style";
import { printTable } from "./table";

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

async function resolveSetupCredentials(
  parsed: ParsedArgv,
  format: OutputFormat,
): Promise<{ username: string; password: string }> {
  let username = getFlagString(parsed, "username");
  let password = getFlagString(parsed, "password");

  if ((!username || !password) && isInteractive() && format === "text") {
    if (!username) {
      username = (await promptLine("Username:"))?.trim() || undefined;
    }
    if (!password) {
      password = (await promptSecret("Password:")) ?? undefined;
      const confirm = (await promptSecret("Confirm password:")) ?? undefined;
      if (password !== confirm) {
        die("Passwords do not match", format, ExitCode.Usage);
      }
    }
  }

  if (!username || !password) {
    die(
      "setup requires --username and --password",
      format,
      ExitCode.Usage,
      "On a TTY you can run `gojo setup` and enter them interactively",
    );
  }
  return { username, password };
}

async function runSetup(parsed: ParsedArgv, format: OutputFormat): Promise<void> {
  const { username, password } = await resolveSetupCredentials(parsed, format);

  await withContext(getHome(parsed), async (ctx) => {
    const users = new UserService(ctx.db);
    if (users.countUsers() > 0) {
      die(
        "Setup already completed — an admin user already exists",
        format,
        ExitCode.Conflict,
        "Change the password with `gojo auth password` (or Settings → Account in the UI). Setup never creates a second user.",
      );
    }
    try {
      const user = await users.createUser(username, password, "admin");
      printSuccess(`Created admin user ${user.username}`, format);
      printOutput(format, { user: { id: user.id, username: user.username, role: user.role } });
      if (format === "text") {
        console.log(style.dim("Next: gojo service start   # or gojo server start"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      die(message, format, ExitCode.Usage);
    }
  });
}

function parseCsvList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function runInstanceCommand(parsed: ParsedArgv, format: OutputFormat): Promise<void> {
  const sub = parsed.command[1];

  // Registry strangler for migrated instance subcommands.
  // @removal(when: all instance CLI subcommands on registry): drop this special-case — R5
  if (sub === "scheduling-show" || sub === "scheduling-set" || sub === "sweep-worktrees") {
    await withContext(getHome(parsed), async (ctx) => {
      const input =
        sub === "scheduling-set"
          ? {
              maxConcurrentRuns: Number(getFlagString(parsed, "max-concurrent-runs") ?? "2"),
              maxConcurrentRunsPerProject: Number(
                getFlagString(parsed, "max-concurrent-per-project") ?? "1",
              ),
              minStartIntervalMs: Number(getFlagString(parsed, "min-start-interval-ms") ?? "0"),
              maxLoadPerCpu: Number(getFlagString(parsed, "max-load-per-cpu") ?? "0"),
            }
          : {};
      const handled = await tryDispatchCliUseCase(
        getUseCaseRegistry(),
        ctx,
        "instance",
        sub,
        input,
        format,
      );
      if (!handled) {
        die(`unknown instance command: ${sub}`, format, ExitCode.Usage);
      }
    });
    return;
  }

  switch (sub) {
    case "show": {
      await withContext(getHome(parsed), async (ctx) => {
        let apiBaseUrl: string | null = null;
        try {
          apiBaseUrl = resolveApiBaseUrl(ctx.instance);
        } catch {
          apiBaseUrl = null;
        }
        const view = {
          bindHost: ctx.instance.bindHost,
          bindPort: ctx.instance.bindPort,
          publicBaseUrl: ctx.instance.publicBaseUrl,
          trustedProxies: ctx.instance.trustedProxies,
          allowedOrigins: ctx.instance.allowedOrigins,
          ipAllowlist: ctx.instance.ipAllowlist,
          cookieSecure: ctx.instance.cookieSecure,
          paused: ctx.instance.paused,
          telemetryEnabled: ctx.instance.telemetryEnabled,
          apiBaseUrl,
          configPath: ctx.instanceConfigPath,
        };
        if (format === "text") {
          printSection("Instance network", format);
          console.log(`  bind            ${view.bindHost}:${view.bindPort}`);
          console.log(`  publicBaseUrl   ${view.publicBaseUrl ?? "(unset)"}`);
          console.log(`  apiBaseUrl      ${view.apiBaseUrl ?? "(unresolved)"}`);
          console.log(
            `  trustedProxies  ${view.trustedProxies.length ? view.trustedProxies.join(", ") : "(none)"}`,
          );
          console.log(
            `  allowedOrigins  ${view.allowedOrigins.length ? view.allowedOrigins.join(", ") : "(default)"}`,
          );
          console.log(
            `  ipAllowlist     ${view.ipAllowlist.length ? view.ipAllowlist.join(", ") : "(any)"}`,
          );
          console.log(`  cookieSecure    ${view.cookieSecure}`);
          console.log(style.dim(`  config          ${view.configPath}`));
        } else {
          printOutput(format, view);
        }
      });
      return;
    }
    case "set": {
      await withContext(getHome(parsed), async (ctx) => {
        let changed = false;
        const bindHost = getFlagString(parsed, "bind-host");
        const bindPortRaw = getFlagString(parsed, "bind-port");
        const publicBaseUrl = getFlagString(parsed, "public-base-url");
        const clearPublic = hasFlag(parsed, "clear-public-base-url");
        const trustedProxies = parseCsvList(getFlagString(parsed, "trusted-proxies"));
        const allowedOrigins = parseCsvList(getFlagString(parsed, "allowed-origins"));
        const ipAllowlist = parseCsvList(getFlagString(parsed, "ip-allowlist"));
        const cookieSecureRaw = getFlagString(parsed, "cookie-secure");

        if (bindHost) {
          ctx.instance.bindHost = bindHost;
          changed = true;
        }
        if (bindPortRaw) {
          const port = Number(bindPortRaw);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            die("bind-port must be an integer between 1 and 65535", format, ExitCode.Usage);
          }
          ctx.instance.bindPort = port;
          changed = true;
        }
        if (clearPublic) {
          ctx.instance.publicBaseUrl = null;
          changed = true;
        } else if (publicBaseUrl !== undefined) {
          try {
            ctx.instance.publicBaseUrl = normalizePublicBaseUrl(publicBaseUrl);
          } catch (error) {
            die(
              error instanceof Error ? error.message : "Invalid public-base-url",
              format,
              ExitCode.Usage,
            );
          }
          changed = true;
        }
        if (trustedProxies) {
          ctx.instance.trustedProxies = trustedProxies;
          changed = true;
        }
        if (allowedOrigins) {
          ctx.instance.allowedOrigins = allowedOrigins;
          changed = true;
        }
        if (ipAllowlist) {
          ctx.instance.ipAllowlist = ipAllowlist;
          changed = true;
        }
        if (cookieSecureRaw !== undefined) {
          if (
            cookieSecureRaw !== "auto" &&
            cookieSecureRaw !== "always" &&
            cookieSecureRaw !== "never"
          ) {
            die("cookie-secure must be auto, always, or never", format, ExitCode.Usage);
          }
          ctx.instance.cookieSecure = cookieSecureRaw as CookieSecureMode;
          changed = true;
        }

        if (!changed) {
          die(
            "instance set requires at least one flag",
            format,
            ExitCode.Usage,
            "Try `gojo instance set --help`",
          );
        }

        ctx.saveInstanceConfig();
        printSuccess("Updated instance.yaml", format);
        if (format === "text") {
          console.log(style.dim("Restart required: gojo service restart  (or gojo server stop/start)"));
        }
        printOutput(format, {
          restartRequired: true,
          bindHost: ctx.instance.bindHost,
          bindPort: ctx.instance.bindPort,
          publicBaseUrl: ctx.instance.publicBaseUrl,
          trustedProxies: ctx.instance.trustedProxies,
          allowedOrigins: ctx.instance.allowedOrigins,
          ipAllowlist: ctx.instance.ipAllowlist,
          cookieSecure: ctx.instance.cookieSecure,
        });
      });
      return;
    }
    default:
      die(
        `unknown instance command: ${sub ?? ""}`,
        format,
        ExitCode.Usage,
        "Try `gojo instance --help`",
      );
  }
}

async function runAuthCommand(parsed: ParsedArgv, format: OutputFormat): Promise<void> {
  const sub = parsed.command[1];
  switch (sub) {
    case "whoami": {
      await withContext(getHome(parsed), async (ctx) => {
        const users = new UserService(ctx.db);
        const list = users.listUsers();
        if (list.length === 0) {
          die(
            "No users configured",
            format,
            ExitCode.NotFound,
            "Create the first admin with `gojo setup`",
          );
        }
        if (format === "text") {
          printSection("Users", format);
          printTable(list, [
            { key: "username", header: "USERNAME", value: (u) => u.username },
            { key: "role", header: "ROLE", value: (u) => u.role },
            { key: "id", header: "ID", value: (u) => u.id },
            { key: "created", header: "CREATED", value: (u) => u.createdAt },
          ]);
        } else {
          printOutput(format, { users: list });
        }
      });
      return;
    }
    case "password": {
      await withContext(getHome(parsed), async (ctx) => {
        const users = new UserService(ctx.db);
        if (users.countUsers() === 0) {
          die(
            "No users configured",
            format,
            ExitCode.NotFound,
            "Create the first admin with `gojo setup`",
          );
        }
        const usernameFlag = getFlagString(parsed, "username");
        const target =
          (usernameFlag ? users.findByUsername(usernameFlag) : null) ?? users.findFirstAdmin();
        if (!target) {
          die("User not found", format, ExitCode.NotFound, "Try `gojo auth whoami`");
        }

        let currentPassword = getFlagString(parsed, "current-password");
        let newPassword = getFlagString(parsed, "new-password");

        if (format === "text" && isInteractive()) {
          if (!currentPassword) {
            currentPassword = (await promptSecret("Current password:")) ?? undefined;
          }
          if (!newPassword) {
            newPassword = (await promptSecret("New password:")) ?? undefined;
            const confirm = (await promptSecret("Confirm new password:")) ?? undefined;
            if (newPassword !== confirm) {
              die("Passwords do not match", format, ExitCode.Usage);
            }
          }
        }

        if (!currentPassword || !newPassword) {
          die(
            "auth password requires current and new passwords",
            format,
            ExitCode.Usage,
            "On a TTY run `gojo auth password` and enter them interactively, or pass --current-password and --new-password",
          );
        }

        try {
          await users.updatePassword(target.id, currentPassword, newPassword);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = /current password/i.test(message) ? ExitCode.Auth : ExitCode.Usage;
          die(message, format, code);
        }

        printSuccess(`Password updated for ${target.username}`, format);
        printOutput(format, {
          ok: true,
          username: target.username,
          note: "Session cookies are invalid; API tokens still work. Sign in again in the UI.",
        });
      });
      return;
    }
    default:
      die(
        `unknown auth command: ${sub ?? ""}`,
        format,
        ExitCode.Usage,
        "Try `gojo auth --help`",
      );
  }
}

function showHelp(parsed: ParsedArgv): void {
  const [group, sub] = parsed.command;
  if (!group) {
    printOverviewHelp();
    return;
  }
  const cmd = findCommandHelp(group, sub);
  if (cmd && sub) {
    printCommandHelp(cmd);
    return;
  }
  if (cmd && !sub) {
    printCommandHelp(cmd);
    return;
  }
  const g = findGroup(group);
  if (g) {
    printGroupHelp(g);
    return;
  }
  printOverviewHelp();
}

async function runSourceCommand(
  parsed: ParsedArgv,
  format: ReturnType<typeof getOutputFormat>,
): Promise<void> {
  const action = parsed.command[1];
  const sub = parsed.positional[0];
  if (action !== "token" || sub !== "set") {
    die(
      "usage: gojo source token set <sourceId> [--secret-name <name>]",
      format,
      ExitCode.Usage,
      "The token is read from GOJO_SOURCE_TOKEN or prompted securely on a TTY",
    );
  }
  const sourceId = parsed.positional[1];
  if (!sourceId) {
    die("sourceId is required", format, ExitCode.Usage);
  }

  await withContext(getHome(parsed), async (ctx) => {
    const source = ctx.work.sources.findById(sourceId);
    if (!source?.connectionId) {
      die("project source or source connection not found", format, ExitCode.NotFound);
    }
    const connection = ctx.work.connections.findById(source.connectionId);
    if (!connection) {
      die("source connection not found", format, ExitCode.NotFound);
    }
    let token = process.env["GOJO_SOURCE_TOKEN"];
    if (!token && isInteractive()) {
      token = (await promptSecret(`Token for ${source.displayName}:`)) ?? undefined;
    }
    if (!token?.trim()) {
      die(
        "No token provided",
        format,
        ExitCode.Usage,
        "Set GOJO_SOURCE_TOKEN or run this command in an interactive terminal",
      );
    }
    const secretName =
      getFlagString(parsed, "secret-name") ?? `source-token-${source.id}`;
    ctx.secrets.set(secretName, token.trim(), source.projectId);
    const config = (() => {
      try {
        const parsedConfig = JSON.parse(connection.configJson) as unknown;
        return parsedConfig && typeof parsedConfig === "object"
          ? (parsedConfig as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    })();
    ctx.work.connections.updateConfig(
      connection.id,
      JSON.stringify({ ...config, tokenSecretName: secretName }),
    );
    printSuccess(`Stored token for ${source.displayName}`, format);
    printOutput(format, {
      sourceId: source.id,
      connectionId: connection.id,
      tokenSecretName: secretName,
    });
  });
}

async function runApprovalCommand(
  parsed: ParsedArgv,
  format: ReturnType<typeof getOutputFormat>,
): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    const registry = getUseCaseRegistry();

    if (sub === "list") {
      const stateFlag = getFlagString(parsed, "state");
      if (stateFlag) {
        const parsedState = ApprovalStateSchema.safeParse(stateFlag);
        if (!parsedState.success) {
          die("invalid approval state", format, ExitCode.Usage);
        }
      }
      const input: Record<string, unknown> = {
        limit: DEFAULT_PAGE_LIMIT,
        offset: 0,
      };
      const projectFlag = getFlagString(parsed, "project");
      if (projectFlag) input["projectId"] = projectFlag;
      if (stateFlag) input["state"] = stateFlag;
      const handled = await tryDispatchCliUseCase(
        registry,
        ctx,
        "approval",
        "list",
        input,
        format,
      );
      if (!handled) {
        die("unknown approval command: list", format, ExitCode.Usage);
      }
      return;
    }

    const id = parsed.positional[0];
    if (!id) die(`usage: gojo approval ${sub ?? "show"} <id>`, format, ExitCode.Usage);

    if (sub === "show") {
      const handled = await tryDispatchCliUseCase(
        registry,
        ctx,
        "approval",
        "show",
        { id },
        format,
      );
      if (!handled) {
        die("unknown approval command: show", format, ExitCode.Usage);
      }
      return;
    }

    if (sub === "approve" || sub === "reject" || sub === "hold") {
      const handled = await tryDispatchCliUseCase(
        registry,
        ctx,
        "approval",
        sub,
        {
          id,
          note: getFlagString(parsed, "note") ?? null,
          surfaceRef: `cli:${sub}:${id}:${Date.now()}`,
        },
        format,
      );
      if (!handled) {
        die(`unknown approval command: ${sub}`, format, ExitCode.Usage);
      }
      return;
    }

    if (sub === "set-autonomy") {
      const autonomyArg = parsed.positional[1] ?? getFlagString(parsed, "autonomy");
      if (!autonomyArg) {
        die(
          "usage: gojo approval set-autonomy <id> <manual|reviewer|auto>",
          format,
          ExitCode.Usage,
        );
      }
      const handled = await tryDispatchCliUseCase(
        registry,
        ctx,
        "approval",
        "set-autonomy",
        { id, autonomy: autonomyArg },
        format,
      );
      if (!handled) {
        die("unknown approval command: set-autonomy", format, ExitCode.Usage);
      }
      return;
    }

    die(
      `unknown approval command: ${sub ?? ""}`,
      format,
      ExitCode.Usage,
      "Try `gojo approval --help`",
    );
  });
}

async function runWorkCommand(
  parsed: ParsedArgv,
  format: ReturnType<typeof getOutputFormat>,
): Promise<void> {
  const sub = parsed.command[1];
  if (sub !== "claim") {
    die("usage: gojo work claim <workItemId> --agent <name-or-id>", format);
  }
  const workItemId = parsed.positional[0];
  const agentRef = getFlagString(parsed, "agent");
  if (!workItemId || !agentRef) {
    die("workItemId and --agent are required", format, ExitCode.Usage);
  }
  await withContext(getHome(parsed), async (ctx) => {
    const workItem = ctx.work.items.findById(workItemId);
    if (!workItem) die("work item not found", format, ExitCode.NotFound);
    const agent = ctx.repos.agents
      .listByProject(workItem.projectId)
      .find((candidate) => candidate.id === agentRef || candidate.name === agentRef);
    if (!agent?.enabled) die("enabled agent not found", format, ExitCode.NotFound);
    const claimProject = ctx.repos.projects.findById(agent.projectId);
    if (!claimProject?.enabled) die("project is disabled", format, ExitCode.Conflict);
    const run = await ctx.coordinator.enqueueRun({
      projectId: workItem.projectId,
      agentId: agent.id,
      trigger: "work",
      idempotencyKey: `claim:${workItem.id}:${agent.id}`,
      subjectWorkItemId: workItem.id,
    });
    ctx.dispatcher.kick();
    printOutput(format, { run });
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
        const projects = ctx.repos.projects.list();
        if (format === "text") {
          printSection("Projects", format);
          printTable(projects, [
            { key: "name", header: "NAME", value: (p) => p.name },
            { key: "id", header: "ID", value: (p) => p.id },
            { key: "branch", header: "BRANCH", value: (p) => p.defaultBranch },
            { key: "path", header: "PATH", width: 40, value: (p) => p.repoPath },
          ]);
        } else {
          printOutput(format, { projects });
        }
        break;
      }
      case "inspect": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project inspect <id>", format);
        }
        const project = ctx.repos.projects.findById(id);
        if (!project) {
          die("project not found", format, ExitCode.NotFound, "Try `gojo project list`");
        }
        printOutput(format, { project });
        break;
      }
      case "sync": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project sync <id>", format);
        }
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "project",
          "sync",
          { id },
          format,
        );
        if (!handled) {
          die("unknown project command: sync", format, ExitCode.Usage);
        }
        break;
      }
      case "enable": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project enable <id>", format);
        }
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "project",
          "enable",
          { id },
          format,
        );
        if (!handled) {
          die("unknown project command: enable", format, ExitCode.Usage);
        }
        break;
      }
      case "disable": {
        const id = parsed.positional[0];
        if (!id) {
          die("usage: gojo project disable <id>", format);
        }
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "project",
          "disable",
          { id },
          format,
        );
        if (!handled) {
          die("unknown project command: disable", format, ExitCode.Usage);
        }
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
        printOutput(
          format,
          await projectDoctor(project, ctx.repos, {
            worktreesRoot: ctx.paths.worktrees,
          }),
        );
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
      case "migrate-vocab": {
        const pathArg =
          getFlagString(parsed, "path") ??
          parsed.positional[0] ??
          null;
        let repoPath: string;
        let projectId: string | null = null;
        if (pathArg) {
          repoPath = pathArg;
        } else {
          const id = parsed.positional[0];
          if (!id) {
            die(
              "usage: gojo project migrate-vocab (--path <repoPath> | <projectId>)",
              format,
            );
          }
          const project = ctx.repos.projects.findById(id);
          if (!project) {
            die("project not found", format);
          }
          repoPath = project.repoPath;
          projectId = project.id;
        }
        const result: MigrateVocabResult = migrateProjectVocab(repoPath);
        if (projectId && (result.manifestChanged || result.tasksDirMoved)) {
          ctx.platformEvents.append({
            projectId,
            type: "project.vocab_migrated",
            entityKind: "project",
            entityId: projectId,
            topics: ["projects", "agents"],
            data: result,
          });
        }
        printOutput(format, { migration: result });
        break;
      }
      default:
        die(`unknown project command: ${sub ?? ""}`, format);
    }
  });
}

async function runAdapterCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  const adapters = listAdapters();

  switch (sub) {
    case "list": {
      const names = adapters.map((adapter) => adapter.name);
      if (format === "text") {
        printSection("Adapters", format);
        printTable(
          names.map((name) => ({ name })),
          [{ key: "name", header: "NAME", value: (a) => a.name }],
        );
      } else {
        printOutput(format, { adapters: names });
      }
      break;
    }
    case "detect": {
      const detected = await Promise.all(
        adapters.map(async (adapter) => ({
          name: adapter.name,
          ...(await adapter.detect()),
        })),
      );
      if (format === "text") {
        printSection("Adapters", format);
        printTable(detected, [
          { key: "name", header: "NAME", value: (a) => a.name },
          {
            key: "installed",
            header: "INSTALLED",
            value: (a) => (a.installed ? "yes" : "no"),
          },
          { key: "version", header: "VERSION", value: (a) => a.version ?? "—" },
        ]);
      } else {
        printOutput(format, { adapters: detected });
      }
      break;
    }
    case "inspect": {
      const name = parsed.positional[0];
      const adapter = adapters.find((item) => item.name === name);
      if (!adapter) {
        die("adapter not found", format, ExitCode.NotFound, "Try `gojo adapter list`");
      }
      printOutput(format, { name: adapter.name, ...(await adapter.detect()) });
      break;
    }
    case "test": {
      const name = parsed.positional[0] ?? "shell";
      const adapter = adapters.find((item) => item.name === name);
      if (!adapter) {
        die("adapter not found", format);
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
      die(`unknown adapter command: ${sub ?? ""}`, format);
  }
}

async function runAgentCommand(parsed: ParsedArgv, format: ReturnType<typeof getOutputFormat>): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    switch (sub) {
      case "list": {
        const projectId = getFlagString(parsed, "project") ?? parsed.positional[0];
        if (!projectId) {
          die(
            "usage: gojo agent list --project <id>",
            format,
            ExitCode.Usage,
            "List projects with `gojo project list`",
          );
        }
        const agents = ctx.repos.agents.listByProject(projectId);
        if (format === "text") {
          printSection("Agents", format);
          printTable(agents, [
            { key: "name", header: "NAME", value: (a) => a.name },
            { key: "enabled", header: "ON", value: (a) => (a.enabled ? "yes" : "no") },
            { key: "id", header: "ID", value: (a) => a.id },
          ]);
        } else {
          printOutput(format, { agents });
        }
        break;
      }
      case "inspect": {
        const agentId = parsed.positional[0];
        if (!agentId) {
          die("usage: gojo agent inspect <agentId>", format);
        }
        const agent = getAgentDetail(ctx.db, agentId);
        if (!agent) {
          die("agent not found", format);
        }
        printOutput(format, { agent });
        break;
      }
      case "run": {
        const agentId = parsed.positional[0];
        if (!agentId) {
          die("usage: gojo agent run <agentId>", format);
        }
        const agent = ctx.repos.agents.findById(agentId);
        if (!agent) {
          die("agent not found", format);
        }
        const run = await ctx.coordinator.enqueueRun({
          projectId: agent.projectId,
          agentId: agent.id,
          trigger: "manual",
        });
        if (format === "text") {
          process.stderr.write(
            `${style.dim(`queued ${run.id}; waiting for admission slot…`)}\n`,
          );
        }
        await ctx.dispatcher.waitForTerminal(run.id);
        const finished = ctx.repos.runs.findById(run.id);
        printOutput(format, { run: finished });
        break;
      }
      case "enable": {
        const agentId = parsed.positional[0];
        if (!agentId) {
          die("usage: gojo agent enable <agentId>", format);
        }
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "agent",
          "enable",
          { id: agentId },
          format,
        );
        if (!handled) {
          die("unknown agent command: enable", format, ExitCode.Usage);
        }
        break;
      }
      case "disable": {
        const agentId = parsed.positional[0];
        if (!agentId) {
          die("usage: gojo agent disable <agentId>", format);
        }
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "agent",
          "disable",
          { id: agentId },
          format,
        );
        if (!handled) {
          die("unknown agent command: disable", format, ExitCode.Usage);
        }
        break;
      }
      case "cancel": {
        const runId = parsed.positional[0];
        if (!runId) {
          die("usage: gojo agent cancel <runId>", format);
        }
        await ctx.coordinator.cancelRun(runId);
        printOutput(format, { run: ctx.repos.runs.findById(runId) });
        break;
      }
      case "retry": {
        const runId = parsed.positional[0];
        if (!runId) {
          die("usage: gojo agent retry <runId>", format);
        }
        const existing = ctx.repos.runs.findById(runId);
        if (!existing) {
          die("run not found", format);
        }
        const run = await ctx.coordinator.enqueueRun({
          projectId: existing.projectId,
          agentId: existing.agentId,
          trigger: "manual",
        });
        if (format === "text") {
          process.stderr.write(
            `${style.dim(`queued ${run.id}; waiting for admission slot…`)}\n`,
          );
        }
        await ctx.dispatcher.waitForTerminal(run.id);
        const finished = ctx.repos.runs.findById(run.id);
        printOutput(format, { run: finished });
        break;
      }
      default:
        die(`unknown agent command: ${sub ?? ""}`, format);
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
        const schedules = listAll() as Array<{
          id: string;
          agent_id: string;
          cron_expr: string;
          enabled: number;
          next_run_at: string | null;
        }>;
        if (format === "text") {
          printSection("Schedules", format);
          printTable(schedules, [
            { key: "id", header: "ID", value: (s) => s.id },
            { key: "agent", header: "AGENT", value: (s) => s.agent_id },
            { key: "cron", header: "CRON", value: (s) => s.cron_expr },
            { key: "on", header: "ON", value: (s) => (s.enabled ? "yes" : "no") },
            { key: "next", header: "NEXT", value: (s) => s.next_run_at ?? "—" },
          ]);
        } else {
          printOutput(format, { schedules });
        }
        break;
      }
      case "enable":
      case "disable":
      case "pause": {
        const id = parsed.positional[0];
        if (!id) {
          die(`usage: gojo schedule ${sub} <id>`, format);
        }
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "schedule",
          sub,
          { id },
          format,
        );
        if (!handled) {
          die(`unknown schedule command: ${sub}`, format, ExitCode.Usage);
        }
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
        if (format === "text") {
          printSection("Runs", format);
          printTable(runs, [
            { key: "id", header: "ID", value: (r) => r.id },
            { key: "state", header: "STATE", value: (r) => r.state },
            { key: "trigger", header: "TRIGGER", value: (r) => r.trigger },
            { key: "agent", header: "AGENT", value: (r) => r.agentId },
            { key: "created", header: "CREATED", value: (r) => r.createdAt },
          ]);
        } else {
          printOutput(format, { runs });
        }
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


async function runIntegrationCommand(
  parsed: ParsedArgv,
  format: ReturnType<typeof getOutputFormat>,
): Promise<void> {
  const sub = parsed.command[1];
  await withContext(getHome(parsed), async (ctx) => {
    switch (sub) {
      case "list": {
        const wantAll = hasFlag(parsed, "all");
        const wantOpen = hasFlag(parsed, "open");
        const wantMerged = hasFlag(parsed, "merged");
        const wantCommitted = hasFlag(parsed, "committed");
        const selected = [wantAll, wantOpen, wantMerged, wantCommitted].filter(Boolean).length;
        if (selected > 1) {
          die(
            "usage: gojo integration list [--all|--open|--merged|--committed] [--project <id>]",
            format,
          );
        }
        const projectId = getFlagString(parsed, "project");
        const status = wantOpen
          ? "open"
          : wantMerged
            ? "merged"
            : wantCommitted
              ? "committed"
              : "all";
        const result = listIntegrationsPage(ctx.db, {
          limit: DEFAULT_PAGE_LIMIT,
          offset: 0,
          status,
          ...(projectId ? { projectId } : {}),
        });
        if (format === "text") {
          printSection(`Integrations (${status}) · ${result.total}`, format);
          printTable(result.items, [
            { key: "run", header: "RUN", value: (i) => i.runId },
            {
              key: "project",
              header: "PROJECT",
              value: (i) => i.projectName ?? i.projectId,
            },
            {
              key: "pr",
              header: "PR",
              value: (i) => (i.prNumber != null ? String(i.prNumber) : "—"),
            },
            { key: "status", header: "STATUS", value: (i) => i.status },
            {
              key: "url",
              header: "URL",
              width: 40,
              value: (i) => i.prUrl ?? "—",
            },
          ]);
        } else {
          printOutput(format, {
            integrations: result.items,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
          });
        }
        break;
      }
      default:
        die(`unknown integration command: ${sub ?? ""}`, format);
    }
  });
}

// @removal(when: all CLI groups dispatch via registry): shrink this file to transport only — R5
async function main(argv: string[]): Promise<void> {
  const parsed = parseArgv(argv);
  const format = getOutputFormat(parsed);

  if (parsed.command.length === 0 && !hasFlag(parsed, "help")) {
    printOverviewHelp();
    return;
  }

  if (hasFlag(parsed, "help")) {
    showHelp(parsed);
    return;
  }

  const [group, sub] = parsed.command;
  if (!group) {
    printOverviewHelp();
    return;
  }

  // `gojo project` with no subcommand → group help
  if (!sub && group !== "setup" && findGroup(group)) {
    printGroupHelp(findGroup(group)!);
    return;
  }

  try {
    if (group === "setup") {
      await runSetup(parsed, format);
      return;
    }

    if (group === "auth") {
      await runAuthCommand(parsed, format);
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
          die(
            `unknown server command: ${sub ?? ""}`,
            format,
            ExitCode.Usage,
            "Try `gojo server --help`",
          );
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

    if (group === "source") {
      await runSourceCommand(parsed, format);
      return;
    }

    if (group === "approval") {
      await runApprovalCommand(parsed, format);
      return;
    }

    if (group === "work") {
      await runWorkCommand(parsed, format);
      return;
    }

    if (group === "adapter") {
      await runAdapterCommand(parsed, format);
      return;
    }

    if (group === "agent") {
      await runAgentCommand(parsed, format);
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

    if (group === "instance") {
      await runInstanceCommand(parsed, format);
      return;
    }

    if (group === "work-status") {
      if (sub !== "rebuild") {
        die(
          "usage: gojo work-status rebuild [--project <id>] [--from <iso>]",
          format,
          ExitCode.Usage,
          "Try `gojo work-status --help`",
        );
      }
      await withContext(getHome(parsed), async (ctx) => {
        const projectId = getFlagString(parsed, "project");
        const from = getFlagString(parsed, "from");
        const input: Record<string, unknown> = {};
        if (projectId) input["projectId"] = projectId;
        if (from) input["from"] = from;
        const handled = await tryDispatchCliUseCase(
          getUseCaseRegistry(),
          ctx,
          "work-status",
          "rebuild",
          input,
          format,
        );
        if (!handled) {
          die("unknown work-status command: rebuild", format, ExitCode.Usage);
        }
      });
      return;
    }

    const suggestions = suggestCommands(group);
    die(
      `unknown command group: ${group}`,
      format,
      ExitCode.Usage,
      suggestions.length > 0
        ? `Did you mean: ${suggestions.map((s) => `gojo ${s}`).join(", ")}? See \`gojo --help\``
        : "See `gojo --help`",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    die(message, format);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
