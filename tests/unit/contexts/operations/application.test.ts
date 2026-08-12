import { describe, expect, test } from "bun:test";

import { browseFilesystemQuery } from "@/contexts/operations/application/filesystem";
import { instanceDoctorQuery } from "@/contexts/operations/application/diagnostics";
import { sweepWorktreesCommand } from "@/contexts/operations/application/worktree-sweep";
import type { DiagnosticsPort } from "@/contexts/operations/ports/diagnostics";
import type { FilesystemBrowser } from "@/contexts/operations/ports/filesystem-browser";
import type { WorktreeSweepPort } from "@/contexts/operations/ports/worktree-sweep";

describe("contexts/operations application", () => {
  test("browseFilesystemQuery returns listing from browser", async () => {
    const browser: FilesystemBrowser = {
      browse: (path) => ({
        listing: { path: path ?? "/", entries: [{ name: "README.md" }] },
        roots: ["/"],
      }),
    };

    const result = await browseFilesystemQuery({ browser }, { path: "/repo" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.listing.path).toBe("/repo");
      expect(result.value.listing.entries).toHaveLength(1);
    }

    const defaultPath = await browseFilesystemQuery({ browser }, {});
    expect(defaultPath.ok).toBe(true);
    if (defaultPath.ok) {
      expect(defaultPath.value.listing.path).toBe("/");
    }
  });

  test("browseFilesystemQuery maps thrown errors to err", async () => {
    const browser: FilesystemBrowser = {
      browse: () => {
        throw new Error("path outside roots");
      },
    };

    const result = await browseFilesystemQuery({ browser }, { path: "/etc" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("path outside roots");
    }

    const nonError: FilesystemBrowser = {
      browse: () => {
        throw "denied";
      },
    };
    const fallback = await browseFilesystemQuery({ browser: nonError }, { path: "/etc" });
    expect(fallback.ok).toBe(false);
    if (!fallback.ok) {
      expect(fallback.error).toBe("denied");
    }
  });

  test("sweepWorktreesCommand returns sweep result or maps failures", async () => {
    const sweep: WorktreeSweepPort = {
      sweep: async () => ({
        scanned: 2,
        removed: ["/tmp/orphan"],
        keptLive: ["/tmp/live"],
        errors: [],
      }),
    };

    const ok = await sweepWorktreesCommand({ sweep });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.removed).toEqual(["/tmp/orphan"]);
    }

    const failing: WorktreeSweepPort = {
      sweep: async () => {
        throw new Error("git worktree list failed");
      },
    };
    const err = await sweepWorktreesCommand({ sweep: failing });
    expect(err.ok).toBe(false);
    if (!err.ok) {
      expect(err.error).toBe("git worktree list failed");
    }
  });

  test("instanceDoctorQuery returns diagnostics or maps failures", async () => {
    const diagnostics: DiagnosticsPort = {
      instanceDoctor: async () => ({ healthy: true, checks: [] }),
    };

    const ok = await instanceDoctorQuery({ diagnostics });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value).toEqual({ healthy: true, checks: [] });
    }

    const failing: DiagnosticsPort = {
      instanceDoctor: async () => {
        throw new Error("doctor subprocess failed");
      },
    };
    const err = await instanceDoctorQuery({ diagnostics: failing });
    expect(err.ok).toBe(false);
    if (!err.ok) {
      expect(err.error).toBe("doctor subprocess failed");
    }
  });
});
