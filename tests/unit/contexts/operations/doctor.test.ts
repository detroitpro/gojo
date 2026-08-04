import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeUnlessCloud } from "../../../support/cloud";

import {
  firstCommandToken,
  primaryValidationTool,
  projectDoctor,
  resolveTool,
  validationToolsForAgents,
} from "@/contexts/operations/infrastructure/diagnostics/doctor";
import {
  commitAll,
  configLocal,
  execGit,
  initRepo,
} from "@/infrastructure/git/git";
import type { Agent } from "@/infrastructure/persistence/types";
import { gojoGitignoreBlock } from "@shared/workspace-files";

describe("diagnostics/doctor helpers", () => {
  test("firstCommandToken extracts the binary", () => {
    expect(firstCommandToken("bun run typecheck")).toBe("bun");
    expect(firstCommandToken("  bash scripts/with-bun.sh typecheck")).toBe("bash");
    expect(firstCommandToken("")).toBe("");
  });

  test("primaryValidationTool skips shell builtins like cd/test", () => {
    expect(primaryValidationTool("cd backend && yarn lint:check")).toEqual({
      binary: "yarn",
      shellBuiltin: false,
    });
    expect(primaryValidationTool("test -f .gojo/handoff.json")).toEqual({
      binary: "test",
      shellBuiltin: true,
    });
    expect(primaryValidationTool("bun run typecheck")).toEqual({
      binary: "bun",
      shellBuiltin: false,
    });
  });

  test("resolveTool finds bun on PATH and relative scripts in cwd", () => {
    const bun = resolveTool("bun");
    expect(bun.found).toBe(true);
    expect(bun.path).toBeTruthy();

    const missing = resolveTool("definitely-not-a-gojo-binary-xyz");
    expect(missing.found).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "gojo-doctor-tool-"));
    try {
      writeFileSync(join(dir, "wrapper.sh"), "#!/bin/sh\n", { mode: 0o755 });
      const rel = resolveTool("./wrapper.sh", dir);
      expect(rel.found).toBe(true);
      expect(rel.path).toBe(join(dir, "wrapper.sh"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validationToolsForAgents reports missing binaries", () => {
    const agents = [
      {
        id: "t1",
        projectId: "p1",
        name: "maintain-tests",
        enabled: true,
        validationProfileJson: JSON.stringify({
          steps: [
            { name: "typecheck", command: "bun run typecheck" },
            { name: "missing-bin", command: "definitely-not-a-gojo-binary-xyz --help" },
            { name: "lint", command: "cd backend && yarn lint:check" },
            { name: "handoff", command: "test -f .gojo/handoff.json" },
          ],
        }),
      },
      {
        id: "t2",
        projectId: "p1",
        name: "disabled",
        enabled: false,
        validationProfileJson: JSON.stringify({
          steps: [{ name: "x", command: "bun test" }],
        }),
      },
    ] as Agent[];

    const tools = validationToolsForAgents(agents, process.cwd());
    expect(tools).toHaveLength(4);
    expect(tools[0]?.binary).toBe("bun");
    expect(tools[0]?.found).toBe(true);
    expect(tools[1]?.found).toBe(false);
    expect(tools[1]?.agent).toBe("maintain-tests");
    expect(tools[2]?.binary).toBe("yarn");
    expect(tools[3]?.binary).toBe("test");
    expect(tools[3]?.found).toBe(true);
    expect(tools[3]?.shellBuiltin).toBe(true);
  });
});

describeUnlessCloud("diagnostics/projectDoctor", () => {
  test("reports dirty base checkout and validation tools", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "gojo-doctor-proj-"));
    try {
      const repoPath = join(tempDir, "repo");
      mkdirSync(repoPath, { recursive: true });
      await initRepo(repoPath);
      await configLocal(repoPath, "user.email", "test@example.com");
      await configLocal(repoPath, "user.name", "Gojo Test");
      writeFileSync(join(repoPath, "README.md"), "# doc\n");
      writeFileSync(join(repoPath, "gojo.yaml"), "project:\n  name: demo\n");
      await commitAll(repoPath, "initial");
      writeFileSync(join(repoPath, "dirty.txt"), "uncommitted\n");

      const project = {
        id: "01PROJECTDOCTORTEST000001",
        name: "demo",
        repoPath,
        defaultBranch: "main",
        remoteUrl: null,
        manifestJson: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const repos = {
        agents: {
          listByProject: () =>
            [
              {
                id: "t1",
                projectId: project.id,
                name: "maintain-tests",
                enabled: true,
                validationProfileJson: JSON.stringify({
                  steps: [{ name: "typecheck", command: "bun run typecheck" }],
                }),
              },
            ] as Agent[],
        },
      };

      const result = await projectDoctor(project as never, repos as never);
      expect(result.repoExists).toBe(true);
      expect(result.manifest).toBe(true);
      expect(result.baseCheckout.clean).toBe(false);
      expect(result.baseCheckout.dirtyFiles.some((f) => f.includes("dirty.txt"))).toBe(
        true,
      );
      expect(result.validationTools).toHaveLength(1);
      expect(result.validationTools[0]?.found).toBe(true);

      // Clean tree after removing the dirty file.
      rmSync(join(repoPath, "dirty.txt"));
      const clean = await projectDoctor(project as never, repos as never);
      expect(clean.baseCheckout.clean).toBe(true);
      expect((await execGit(repoPath, ["status", "--porcelain"])).stdout).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("flags generated .gojo files that are tracked or unignored", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "gojo-doctor-ignore-"));
    try {
      const repoPath = join(tempDir, "repo");
      mkdirSync(join(repoPath, ".gojo", "agents"), { recursive: true });
      await initRepo(repoPath);
      await configLocal(repoPath, "user.email", "test@example.com");
      await configLocal(repoPath, "user.name", "Gojo Test");
      writeFileSync(join(repoPath, "gojo.yaml"), "project:\n  name: demo\n");
      writeFileSync(join(repoPath, ".gojo", "agents", "demo.md"), "# demo\n");
      writeFileSync(join(repoPath, ".gojo", "handoff.json"), '{"status":"success"}');
      await commitAll(repoPath, "initial");

      const project = {
        id: "01PROJECTDOCTORTEST000002",
        name: "demo",
        repoPath,
        defaultBranch: "main",
        remoteUrl: null,
        manifestJson: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const repos = { agents: { listByProject: () => [] as Agent[] } };

      const before = await projectDoctor(project as never, repos as never);
      expect(before.workspaceFiles.trackedGeneratedFiles).toContain(".gojo/handoff.json");
      expect(before.workspaceFiles.unignoredGeneratedFiles).toContain(".gojo/handoff.json");
      expect(before.workspaceFiles.suggestedGitignore).toContain(".gojo/*");
      expect(before.workspaceFiles.suggestedGitignore).toContain("!.gojo/agents/");

      writeFileSync(
        join(repoPath, ".gitignore"),
        `${gojoGitignoreBlock()}\n`,
      );
      await execGit(repoPath, ["rm", "--cached", "-q", ".gojo/handoff.json"]);
      await commitAll(repoPath, "ignore generated gojo files");

      const after = await projectDoctor(project as never, repos as never);
      expect(after.workspaceFiles.trackedGeneratedFiles).toEqual([]);
      expect(after.workspaceFiles.unignoredGeneratedFiles).toEqual([]);
      expect(after.workspaceFiles.untrackedRegistrationFiles).toEqual([]);
      expect(after.workspaceFiles.suggestedGitignore).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
