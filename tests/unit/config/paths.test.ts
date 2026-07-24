import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { defaultHomeDir, ensureLayout, resolvePaths } from "@/config/paths";

describe("config/paths", () => {
  let tempHome: string | null = null;
  const previousGojoHome = process.env["GOJO_HOME"];

  afterEach(() => {
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
      tempHome = null;
    }
    if (previousGojoHome === undefined) {
      delete process.env["GOJO_HOME"];
    } else {
      process.env["GOJO_HOME"] = previousGojoHome;
    }
  });

  test("defaultHomeDir uses GOJO_HOME when set", () => {
    process.env["GOJO_HOME"] = "/tmp/custom-gojo-home";
    expect(defaultHomeDir()).toBe("/tmp/custom-gojo-home");
  });

  test("defaultHomeDir falls back to ~/.gojo", () => {
    delete process.env["GOJO_HOME"];
    expect(defaultHomeDir()).toBe(join(homedir(), ".gojo"));
  });

  test("ensureLayout creates expected directories", () => {
    tempHome = join(homedir(), `.gojo-paths-test-${Date.now()}`);
    ensureLayout(tempHome);

    const paths = resolvePaths(tempHome);
    for (const dir of [
      paths.config,
      paths.data,
      paths.repositories,
      paths.worktrees,
      paths.artifacts,
      paths.logs,
      paths.cache,
      paths.secrets,
      paths.updates,
    ]) {
      expect(existsSync(dir)).toBe(true);
    }
  });

  test("resolvePaths returns canonical layout", () => {
    tempHome = join(homedir(), `.gojo-paths-test-${Date.now()}`);
    const paths = resolvePaths(tempHome);

    expect(paths.home).toBe(tempHome);
    expect(paths.config).toBe(join(tempHome, "config"));
    expect(paths.data).toBe(join(tempHome, "data"));
    expect(paths.db).toBe(join(tempHome, "data", "gojo.db"));
    expect(paths.secrets).toBe(join(tempHome, "secrets"));
  });
});
