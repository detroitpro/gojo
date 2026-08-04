import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listDirectory,
  resolveBrowsePath,
  suggestProjectName,
} from "@/infrastructure/filesystem/browse";

describe("filesystem/browse", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("lists directories and marks git repos", () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-browse-`);
    mkdirSync(join(tempDir, "alpha"));
    mkdirSync(join(tempDir, "beta", ".git"), { recursive: true });
    writeFileSync(join(tempDir, "readme.txt"), "skip me");
    mkdirSync(join(tempDir, ".hidden"));

    const listing = listDirectory(tempDir);
    expect(listing.path).toBe(resolveBrowsePath(tempDir));
    expect(listing.entries.map((e) => e.name)).toEqual(["beta", "alpha"]);
    expect(listing.entries.find((e) => e.name === "beta")?.isGitRepo).toBe(true);
    expect(listing.entries.find((e) => e.name === "alpha")?.isGitRepo).toBe(false);
    expect(listing.entries.some((e) => e.name === "readme.txt")).toBe(false);
    expect(listing.entries.some((e) => e.name === ".hidden")).toBe(false);
  });

  test("rejects files and missing paths", () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-browse-`);
    const root = tempDir;
    const file = join(root, "file.txt");
    writeFileSync(file, "x");
    expect(() => listDirectory(file)).toThrow(/Not a directory/);
    expect(() => listDirectory(join(root, "missing"))).toThrow(/does not exist/);
  });

  test("suggestProjectName uses basename", () => {
    expect(suggestProjectName("/home/u/projects/billing-service")).toBe("billing-service");
    expect(suggestProjectName("/home/u/projects/billing-service/")).toBe("billing-service");
  });
});
