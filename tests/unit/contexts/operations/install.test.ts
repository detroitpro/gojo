import { describe, expect, test } from "bun:test";
import { platform } from "node:os";

import {
  DEFAULT_SERVICE_PATH,
  renderLaunchdPlist,
  renderSystemdUnit,
  resolveServiceLaunch,
  resolveServicePath,
  serviceControl,
} from "@/contexts/operations/infrastructure/service/install";

describe("resolveServiceLaunch", () => {
  test("compiled binary uses process.execPath and server args only", () => {
    const home = "/home/me/.gojo";
    const launch = resolveServiceLaunch(home, "/$bunfs/root/src/transports/cli/index.ts");

    expect(launch.execPath).toBe(process.execPath);
    expect(launch.execPath).not.toBe("bun");
    expect(launch.execPath.startsWith("/")).toBe(true);
    expect(launch.args).toEqual(["server", "start", "--home", home]);
    // Must not depend on cwd / a source checkout being present.
    expect(launch.args.some((a) => a.endsWith("index.ts"))).toBe(false);
  });

  test("source runtime launches bun with the TypeScript entry", () => {
    const home = "/home/me/.gojo";
    const entry = "/repo/src/transports/cli/index.ts";
    const launch = resolveServiceLaunch(home, entry);

    expect(launch.execPath).toBe(process.execPath);
    expect(launch.execPath.startsWith("/")).toBe(true);
    expect(launch.args).toEqual([entry, "server", "start", "--home", home]);
  });

  test("never uses bare bun as execPath (Bun compile argv[0] regression)", () => {
    // Bun-compiled binaries report argv[0] as the bare string "bun". Using that
    // as ExecStart makes systemd fail with status=203/EXEC.
    const launch = resolveServiceLaunch("/tmp/gojo-home", "/$bunfs/root/cli.js");
    expect(launch.execPath).toBe(process.execPath);
    expect(launch.execPath).not.toBe("bun");
    expect(launch.execPath.includes("/")).toBe(true);
  });
});

describe("renderSystemdUnit", () => {
  test("ExecStart uses absolute binary path, not bare bun", () => {
    const home = "/home/me/.gojo";
    const launch = resolveServiceLaunch(home, "/$bunfs/root/src/transports/cli/index.ts");
    // Simulate an installed compiled binary path.
    const installed = {
      execPath: "/home/me/.local/bin/gojo",
      args: launch.args,
      home,
    };
    const unit = renderSystemdUnit(installed);

    expect(unit).toContain("ExecStart=/home/me/.local/bin/gojo server start --home /home/me/.gojo");
    expect(unit).not.toMatch(/^ExecStart=bun(\s|$)/m);
    expect(unit).toContain("Environment=GOJO_HOME=/home/me/.gojo");
    expect(unit).toMatch(/^Environment=PATH=/m);
    expect(unit).toContain("WantedBy=default.target");
  });

  test("embeds install-time PATH (or fallback) so validation finds bun", () => {
    const unit = renderSystemdUnit({
      home: "/home/me/.gojo",
      execPath: "/home/me/.local/bin/gojo",
      args: ["server", "start", "--home", "/home/me/.gojo"],
      path: "/home/me/.bun/bin:/usr/bin:/bin",
    });
    expect(unit).toContain("Environment=PATH=/home/me/.bun/bin:/usr/bin:/bin");

    expect(resolveServicePath("")).toBe(DEFAULT_SERVICE_PATH);
    expect(resolveServicePath("   ")).toBe(DEFAULT_SERVICE_PATH);
    expect(resolveServicePath("/custom/bin")).toBe("/custom/bin");
  });

  test("quotes paths with spaces", () => {
    const unit = renderSystemdUnit({
      home: "/home/me/Gojo Home",
      execPath: "/opt/Gojo App/gojo",
      args: ["server", "start", "--home", "/home/me/Gojo Home"],
    });
    expect(unit).toContain("ExecStart='/opt/Gojo App/gojo' server start --home '/home/me/Gojo Home'");
    expect(unit).toContain("Environment=GOJO_HOME='/home/me/Gojo Home'");
  });

  test("rejects the historical broken ExecStart shape", () => {
    // Old bug: argv[0] ("bun") + ["server","start",...] with no script path.
    const broken = renderSystemdUnit({
      home: "/home/me/.gojo",
      execPath: "bun",
      args: ["server", "start", "--home", "/home/me/.gojo"],
    });
    expect(broken).toMatch(/^ExecStart=bun server start/m);

    const fixed = renderSystemdUnit({
      home: "/home/me/.gojo",
      execPath: "/home/me/.local/bin/gojo",
      args: ["server", "start", "--home", "/home/me/.gojo"],
    });
    expect(fixed).not.toMatch(/^ExecStart=bun(\s|$)/m);
    expect(fixed).toMatch(/^ExecStart=\/home\/me\/\.local\/bin\/gojo /m);
  });
});

describe("renderLaunchdPlist", () => {
  test("ProgramArguments start with absolute binary then server start", () => {
    const plist = renderLaunchdPlist({
      home: "/Users/me/.gojo",
      execPath: "/Users/me/.local/bin/gojo",
      args: ["server", "start", "--home", "/Users/me/.gojo"],
      path: "/Users/me/.bun/bin:/usr/bin:/bin",
    });
    expect(plist).toContain("<string>/Users/me/.local/bin/gojo</string>");
    expect(plist).toContain("<string>server</string>");
    expect(plist).toContain("<string>start</string>");
    expect(plist).toContain("<string>/Users/me/.gojo</string>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("<string>/Users/me/.bun/bin:/usr/bin:/bin</string>");
    expect(plist).not.toContain("<string>bun</string>");
  });
});

describe("serviceControl", () => {
  test("includes status (and daemon-reload) on the current platform", () => {
    const status = serviceControl("status");
    const reload = serviceControl("daemon-reload");

    if (platform() === "linux") {
      expect(status).toEqual(["systemctl", "--user", "status", "gojo.service", "--no-pager"]);
      expect(reload).toEqual(["systemctl", "--user", "daemon-reload"]);
    } else if (platform() === "darwin") {
      expect(status[0]).toBe("launchctl");
      expect(status).toContain("print");
      expect(reload).toEqual(["true"]);
    } else {
      expect(() => serviceControl("status")).toThrow();
    }
  });

  test("start/stop/restart/logs remain available", () => {
    for (const cmd of ["start", "stop", "restart", "logs"] as const) {
      const argv = serviceControl(cmd);
      expect(argv.length).toBeGreaterThan(0);
      expect(argv[0]).toBeTruthy();
    }
  });
});
