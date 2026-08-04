import { style } from "./style";

export interface CommandFlag {
  name: string;
  summary: string;
  required?: boolean;
}

export interface CommandHelp {
  /** e.g. "setup" or "project list" */
  path: string;
  summary: string;
  usage?: string;
  flags?: CommandFlag[];
  examples?: string[];
  related?: string[];
  notes?: string[];
}

export interface CommandGroup {
  name: string;
  summary: string;
  commands: CommandHelp[];
}

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    name: "setup",
    summary: "Create the first admin user (once)",
    commands: [
      {
        path: "setup",
        summary: "Create the first admin user",
        usage: "gojo setup [--username <name>] [--password <secret>]",
        flags: [
          { name: "--username", summary: "Admin username (prompted on TTY if omitted)" },
          { name: "--password", summary: "Admin password (prompted on TTY if omitted)" },
        ],
        examples: ["gojo setup", "gojo setup --username admin --password '********'"],
        notes: [
          "Create-once: fails if any user already exists.",
          "To change an existing password: gojo auth password",
        ],
        related: ["auth password", "auth whoami"],
      },
    ],
  },
  {
    name: "auth",
    summary: "Account and password (local database)",
    commands: [
      {
        path: "auth whoami",
        summary: "Show the local admin user",
        usage: "gojo auth whoami",
        related: ["auth password", "setup"],
      },
      {
        path: "auth password",
        summary: "Change the admin password (works offline)",
        usage: "gojo auth password [--username <name>]",
        flags: [
          { name: "--username", summary: "Account to update (defaults to first admin)" },
        ],
        examples: ["gojo auth password", "gojo auth password --username admin"],
        notes: [
          "Prompts for current and new password on a TTY.",
          "Updates ~/.gojo directly — the daemon does not need to be running.",
          "Session cookies are invalidated; API tokens keep working.",
        ],
        related: ["auth whoami", "setup"],
      },
    ],
  },
  {
    name: "server",
    summary: "Foreground / PID-file daemon control",
    commands: [
      {
        path: "server start",
        summary: "Start API + scheduler + web UI",
        usage: "gojo server start [--daemon]",
        flags: [{ name: "--daemon", summary: "Return immediately; process keeps running" }],
      },
      { path: "server status", summary: "PID and health probe", usage: "gojo server status" },
      { path: "server stop", summary: "Stop via PID file", usage: "gojo server stop" },
      {
        path: "server doctor",
        summary: "Git, disk, DB, adapters, daemon PATH tools",
        usage: "gojo server doctor",
      },
    ],
  },
  {
    name: "service",
    summary: "systemd / launchd unit lifecycle",
    commands: [
      { path: "service install", summary: "Install user service unit", usage: "gojo service install" },
      { path: "service uninstall", summary: "Remove unit", usage: "gojo service uninstall" },
      { path: "service start", summary: "Start service", usage: "gojo service start" },
      { path: "service stop", summary: "Stop service", usage: "gojo service stop" },
      { path: "service restart", summary: "Restart service", usage: "gojo service restart" },
      { path: "service status", summary: "Service status", usage: "gojo service status" },
      { path: "service logs", summary: "Follow service logs", usage: "gojo service logs" },
    ],
  },
  {
    name: "project",
    summary: "Register and manage repositories",
    commands: [
      {
        path: "project add",
        summary: "Register a repo",
        usage: "gojo project add <name> <repoPath> [--branch <b>] [--remote <url>]",
      },
      { path: "project list", summary: "List projects", usage: "gojo project list" },
      { path: "project inspect", summary: "Inspect one project", usage: "gojo project inspect <id>" },
      { path: "project sync", summary: "Sync manifest into DB", usage: "gojo project sync <id>" },
      {
        path: "project enable",
        summary: "Enable project (runtime gate)",
        usage: "gojo project enable <id>",
      },
      {
        path: "project disable",
        summary: "Disable project (runtime gate)",
        usage: "gojo project disable <id>",
      },
      { path: "project doctor", summary: "Project health checks", usage: "gojo project doctor <id>" },
      {
        path: "project work",
        summary: "Paged work ledger",
        usage: "gojo project work <id> [--kind …] [--history]",
      },
      { path: "project status", summary: "Work status counts", usage: "gojo project status <id>" },
      { path: "project sources", summary: "Connected sources", usage: "gojo project sources <id>" },
      {
        path: "project refresh-source",
        summary: "Reconcile one source",
        usage: "gojo project refresh-source <id> <sourceId>",
      },
      {
        path: "project migrate-vocab",
        summary: "Rewrite tasks→agents in a project checkout",
        usage: "gojo project migrate-vocab <id>",
      },
      { path: "project remove", summary: "Unregister a project", usage: "gojo project remove <id>" },
    ],
  },
  {
    name: "adapter",
    summary: "Detect installed agent CLIs",
    commands: [
      { path: "adapter detect", summary: "Detect adapters", usage: "gojo adapter detect" },
      { path: "adapter list", summary: "List adapters", usage: "gojo adapter list" },
      { path: "adapter inspect", summary: "Inspect one adapter", usage: "gojo adapter inspect <name>" },
      { path: "adapter test", summary: "Probe an adapter", usage: "gojo adapter test <name>" },
    ],
  },
  {
    name: "source",
    summary: "Configure source-system credentials",
    commands: [
      {
        path: "source token set",
        summary: "Store a source token in the encrypted secret store",
        usage: "gojo source token set <sourceId> [--secret-name <name>]",
      },
    ],
  },
  {
    name: "approval",
    summary: "Review and control pending integrations",
    commands: [
      { path: "approval list", summary: "List approvals", usage: "gojo approval list [--state <state>] [--project <id>]" },
      { path: "approval show", summary: "Inspect an approval", usage: "gojo approval show <id>" },
      { path: "approval approve", summary: "Approve and merge", usage: "gojo approval approve <id> [--note <text>]" },
      { path: "approval reject", summary: "Reject an approval", usage: "gojo approval reject <id> [--note <text>]" },
      { path: "approval hold", summary: "Hold an approval", usage: "gojo approval hold <id> [--note <text>]" },
      {
        path: "approval set-autonomy",
        summary: "Update snapshotted autonomy and re-advance when ready",
        usage: "gojo approval set-autonomy <id> <manual|reviewer|auto>",
        notes: [
          "Autonomy is snapshotted when the PR opens; use this after changing agent approval: in gojo.yaml.",
          "When checks are green and review is pass, reviewer/auto will merge immediately.",
        ],
      },
    ],
  },
  {
    name: "work",
    summary: "Claim source work for an agent",
    commands: [
      {
        path: "work claim",
        summary: "Enqueue an agent for a work item",
        usage: "gojo work claim <workItemId> --agent <name-or-id>",
      },
    ],
  },
  {
    name: "agent",
    summary: "Work units from gojo.yaml agents:",
    commands: [
      { path: "agent list", summary: "List agents", usage: "gojo agent list [--project <id>]" },
      { path: "agent inspect", summary: "Inspect an agent", usage: "gojo agent inspect <id>" },
      { path: "agent run", summary: "Enqueue a run", usage: "gojo agent run <id>" },
      { path: "agent enable", summary: "Enable an agent", usage: "gojo agent enable <id>" },
      { path: "agent disable", summary: "Disable an agent", usage: "gojo agent disable <id>" },
      { path: "agent cancel", summary: "Cancel a run", usage: "gojo agent cancel <runId>" },
      { path: "agent retry", summary: "Retry a run", usage: "gojo agent retry <runId>" },
    ],
  },
  {
    name: "schedule",
    summary: "Cron schedules",
    commands: [
      { path: "schedule list", summary: "List schedules", usage: "gojo schedule list" },
      { path: "schedule enable", summary: "Enable a schedule", usage: "gojo schedule enable <id>" },
      { path: "schedule disable", summary: "Disable a schedule", usage: "gojo schedule disable <id>" },
      { path: "schedule pause", summary: "Pause a schedule", usage: "gojo schedule pause <id>" },
      { path: "schedule next", summary: "Next fire times", usage: "gojo schedule next <id>" },
    ],
  },
  {
    name: "run",
    summary: "Inspect and govern runs",
    commands: [
      { path: "run list", summary: "List recent runs", usage: "gojo run list [--limit <n>]" },
      { path: "run inspect", summary: "Inspect a run", usage: "gojo run inspect <id>" },
      { path: "run logs", summary: "Show run logs", usage: "gojo run logs <id> [--follow]" },
      { path: "run diff", summary: "Files changed in a run", usage: "gojo run diff <id>" },
      { path: "run approve", summary: "Approve await-approval run", usage: "gojo run approve <id>" },
      { path: "run reject", summary: "Reject await-approval run", usage: "gojo run reject <id>" },
      { path: "run artifacts", summary: "List run artifacts", usage: "gojo run artifacts <id>" },
    ],
  },
  {
    name: "integration",
    summary: "PR / commit integrations",
    commands: [
      {
        path: "integration list",
        summary: "List integrations by status",
        usage: "gojo integration list --open|--merged|--committed [--project <id>]",
      },
    ],
  },
  {
    name: "backup",
    summary: "Instance backups",
    commands: [
      { path: "backup create", summary: "Create a backup", usage: "gojo backup create [--dest <path>]" },
      { path: "backup verify", summary: "Verify a backup", usage: "gojo backup verify <path>" },
      { path: "backup restore", summary: "Restore a backup", usage: "gojo backup restore <path>" },
    ],
  },
  {
    name: "work-status",
    summary: "Rebuild work status rollups",
    commands: [
      {
        path: "work-status rebuild",
        summary: "Rebuild hourly work_status_rollup",
        usage: "gojo work-status rebuild [--project <id>] [--from <iso>]",
      },
    ],
  },
  {
    name: "instance",
    summary: "Network bind and public URL (instance.yaml)",
    commands: [
      {
        path: "instance show",
        summary: "Show bind, publicBaseUrl, proxies, and apiBaseUrl",
        usage: "gojo instance show",
        related: ["instance set", "server doctor"],
      },
      {
        path: "instance set",
        summary: "Update network fields in instance.yaml",
        usage:
          "gojo instance set [--bind-host <host>] [--bind-port <n>] [--public-base-url <url>] [--trusted-proxies <list>] [--allowed-origins <list>] [--ip-allowlist <list>] [--cookie-secure auto|always|never]",
        flags: [
          { name: "--bind-host", summary: "Listen address (127.0.0.1, 0.0.0.0, …)" },
          { name: "--bind-port", summary: "Listen port" },
          {
            name: "--public-base-url",
            summary: "Canonical URL (https://gojo.example.com or http://LAN:7430)",
          },
          {
            name: "--trusted-proxies",
            summary: 'Comma-separated CIDRs/IPs or "cloudflare"',
          },
          { name: "--allowed-origins", summary: "Comma-separated CORS/CSRF origins" },
          { name: "--ip-allowlist", summary: "Comma-separated client IP allowlist" },
          { name: "--cookie-secure", summary: "auto | always | never" },
          { name: "--clear-public-base-url", summary: "Unset publicBaseUrl" },
        ],
        examples: [
          "gojo instance set --public-base-url https://gojo.example.com --trusted-proxies cloudflare,127.0.0.1",
          "gojo instance set --bind-host 0.0.0.0 --public-base-url http://192.168.4.73:7430",
        ],
        notes: [
          "Writes ~/.gojo/config/instance.yaml. Restart the daemon for bind/proxy changes.",
          "Setup on loopback first; non-loopback bind requires an admin user + publicBaseUrl.",
        ],
        related: ["instance show", "server restart", "service restart"],
      },
      {
        path: "instance scheduling-show",
        summary: "Show instance scheduling / admission policy",
        usage: "gojo instance scheduling-show",
        related: ["instance scheduling-set", "queue"],
      },
      {
        path: "instance scheduling-set",
        summary: "Update instance scheduling / admission policy",
        usage:
          "gojo instance scheduling-set [--max-concurrent-runs <n>] [--max-concurrent-per-project <n>] [--min-start-interval-ms <n>] [--max-load-per-cpu <n>]",
        flags: [
          { name: "--max-concurrent-runs", summary: "Global concurrent run cap" },
          {
            name: "--max-concurrent-per-project",
            summary: "Per-project concurrent run cap",
          },
          {
            name: "--min-start-interval-ms",
            summary: "Minimum gap between admissions (0 disables)",
          },
          {
            name: "--max-load-per-cpu",
            summary: "Loadavg guard threshold (0 disables)",
          },
        ],
        related: ["instance scheduling-show"],
      },
    ],
  },
];

export function findCommandHelp(group?: string, sub?: string): CommandHelp | null {
  if (!group) {
    return null;
  }
  const g = COMMAND_GROUPS.find((item) => item.name === group);
  if (!g) {
    return null;
  }
  if (!sub) {
    return g.commands[0]?.path === group ? (g.commands[0] ?? null) : null;
  }
  const path = `${group} ${sub}`;
  return g.commands.find((c) => c.path === path) ?? null;
}

export function findGroup(name: string): CommandGroup | null {
  return COMMAND_GROUPS.find((g) => g.name === name) ?? null;
}

export function suggestCommands(input: string): string[] {
  const needle = input.toLowerCase();
  const names = COMMAND_GROUPS.flatMap((g) => [
    g.name,
    ...g.commands.map((c) => c.path),
  ]);
  return names
    .filter((name) => name.includes(needle) || needle.includes(name.split(" ")[0]!))
    .slice(0, 5);
}

export function printOverviewHelp(): void {
  console.log(style.heading("gojo"));
  console.log(style.dim("Scheduled software-agent orchestration"));
  console.log();
  console.log(style.bold("Usage"));
  console.log("  gojo [--home <path>] [--output json|text|yaml] <command> …");
  console.log("  gojo <command> --help");
  console.log();
  console.log(style.bold("Global flags"));
  console.log(`  ${style.cyan("--home")}     Instance home (default ~/.gojo)`);
  console.log(`  ${style.cyan("--output")}   text | json | yaml`);
  console.log(`  ${style.cyan("--help, -h")} Show help`);
  console.log();
  console.log(style.bold("Commands"));
  for (const group of COMMAND_GROUPS) {
    console.log(`  ${style.cyan(group.name.padEnd(14))} ${group.summary}`);
  }
  console.log();
  console.log(style.dim("Exit codes: 0 ok · 1 usage · 2 not found · 3 conflict · 4 auth"));
  console.log(style.dim("Tip: gojo auth password changes the admin password; setup is create-once."));
}

export function printGroupHelp(group: CommandGroup): void {
  console.log(style.heading(`gojo ${group.name}`));
  console.log(group.summary);
  console.log();
  console.log(style.bold("Commands"));
  for (const cmd of group.commands) {
    const leaf = cmd.path === group.name ? group.name : cmd.path.slice(group.name.length + 1);
    console.log(`  ${style.cyan(leaf.padEnd(18))} ${cmd.summary}`);
  }
  console.log();
  console.log(style.dim(`Try: gojo ${group.name} <command> --help`));
}

export function printCommandHelp(cmd: CommandHelp): void {
  console.log(style.heading(`gojo ${cmd.path}`));
  console.log(cmd.summary);
  console.log();
  if (cmd.usage) {
    console.log(style.bold("Usage"));
    console.log(`  ${cmd.usage}`);
    console.log();
  }
  if (cmd.flags?.length) {
    console.log(style.bold("Flags"));
    for (const flag of cmd.flags) {
      const req = flag.required ? style.yellow(" (required)") : "";
      console.log(`  ${style.cyan(flag.name.padEnd(16))} ${flag.summary}${req}`);
    }
    console.log();
  }
  if (cmd.examples?.length) {
    console.log(style.bold("Examples"));
    for (const example of cmd.examples) {
      console.log(`  ${example}`);
    }
    console.log();
  }
  if (cmd.notes?.length) {
    console.log(style.bold("Notes"));
    for (const note of cmd.notes) {
      console.log(`  • ${note}`);
    }
    console.log();
  }
  if (cmd.related?.length) {
    console.log(style.bold("Related"));
    console.log(`  ${cmd.related.map((r) => `gojo ${r}`).join(" · ")}`);
  }
}
