import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface ServiceInstallOptions {
  home: string;
  execPath: string;
  args?: string[];
}

export interface ServiceInstallResult {
  path: string;
  platform: "linux" | "darwin" | "unsupported";
}

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** @internal exported for tests */
export function renderSystemdUnit(options: ServiceInstallOptions): string {
  const parts = [options.execPath, ...(options.args ?? [])].map(shellQuote);
  const execStart = parts.join(" ");
  return `[Unit]
Description=Gojo agent orchestration server
After=network.target

[Service]
Type=simple
Environment=GOJO_HOME=${shellQuote(options.home)}
ExecStart=${execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** @internal exported for tests */
export function renderLaunchdPlist(options: ServiceInstallOptions): string {
  const programArgs = [options.execPath, ...(options.args ?? [])];
  const argsXml = programArgs
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gojo.server</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GOJO_HOME</key>
    <string>${escapeXml(options.home)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function defaultServicePath(currentPlatform = platform()): string {
  if (currentPlatform === "darwin") {
    return join(homedir(), "Library", "LaunchAgents", "com.gojo.server.plist");
  }
  return join(homedir(), ".config", "systemd", "user", "gojo.service");
}

export function installService(options: ServiceInstallOptions): ServiceInstallResult {
  const currentPlatform = platform();

  if (currentPlatform === "linux") {
    const path = defaultServicePath("linux");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, renderSystemdUnit(options), "utf8");
    return { path, platform: "linux" };
  }

  if (currentPlatform === "darwin") {
    const path = defaultServicePath("darwin");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, renderLaunchdPlist(options), "utf8");
    chmodSync(path, 0o644);
    return { path, platform: "darwin" };
  }

  throw new Error(`Service install is not supported on ${currentPlatform}`);
}

export function uninstallService(): ServiceInstallResult {
  const currentPlatform = platform();
  const path = defaultServicePath();

  if (!existsSync(path)) {
    throw new Error(`Service unit not found: ${path}`);
  }

  unlinkSync(path);

  return {
    path,
    platform: currentPlatform === "darwin" ? "darwin" : currentPlatform === "linux" ? "linux" : "unsupported",
  };
}

export function serviceControl(
  command: "start" | "stop" | "restart" | "logs" | "status" | "daemon-reload",
): string[] {
  const currentPlatform = platform();
  if (currentPlatform === "linux") {
    const unit = "gojo.service";
    switch (command) {
      case "daemon-reload":
        return ["systemctl", "--user", "daemon-reload"];
      case "start":
        return ["systemctl", "--user", "start", unit];
      case "stop":
        return ["systemctl", "--user", "stop", unit];
      case "restart":
        return ["systemctl", "--user", "restart", unit];
      case "status":
        return ["systemctl", "--user", "status", unit, "--no-pager"];
      case "logs":
        return ["journalctl", "--user", "-u", unit, "-f"];
    }
  }

  if (currentPlatform === "darwin") {
    const label = "com.gojo.server";
    const plist = defaultServicePath("darwin");
    switch (command) {
      case "daemon-reload":
        return ["true"];
      case "start":
        return ["launchctl", "load", plist];
      case "stop":
        return ["launchctl", "unload", plist];
      case "restart":
        return ["launchctl", "kickstart", "-k", `gui/${process.getuid?.() ?? ""}/${label}`];
      case "status":
        return ["launchctl", "print", `gui/${process.getuid?.() ?? ""}/${label}`];
      case "logs":
        return ["log", "stream", "--predicate", `subsystem == "${label}"`];
    }
  }

  throw new Error(`Service control is not supported on ${currentPlatform}`);
}

/**
 * Resolve absolute ExecStart for the current process.
 * Bun-compiled binaries report argv[0] as "bun"; use process.execPath instead.
 */
export function resolveServiceLaunch(home: string, entryPath = import.meta.path): {
  execPath: string;
  args: string[];
} {
  const compiled = entryPath.startsWith("/$bunfs/");
  if (compiled) {
    return { execPath: process.execPath, args: ["server", "start", "--home", home] };
  }
  return {
    execPath: process.execPath,
    args: [entryPath, "server", "start", "--home", home],
  };
}
