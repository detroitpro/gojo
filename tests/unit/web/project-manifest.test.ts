import { describe, expect, test } from "bun:test";

import {
  computeProjectHealth,
  projectHealthFactors,
} from "../../../web/src/kernel/project-manifest.ts";

describe("computeProjectHealth / projectHealthFactors", () => {
  test("penalizes dirty base checkout by 20", () => {
    const doctor = {
      repoExists: true,
      manifest: true,
      baseCheckout: {
        clean: false,
        dirtyFiles: ["src/foo.ts"],
        behindOrigin: 0,
      },
      validationTools: [],
    };
    const health = computeProjectHealth({ hasManifest: true }, doctor);
    expect(health.score).toBe(80);
    expect(health.level).toBe("warn");
    expect(health.label).toBe("80 · Attention");

    const factors = projectHealthFactors({ hasManifest: true, repoPath: "/tmp/repo" }, doctor);
    const local = factors.find((factor) => factor.id === "local-changes");
    expect(local?.ok).toBe(false);
    expect(local?.penalty).toBe(20);
    expect(local?.remediation).toContain("/tmp/repo");
    expect(local?.details).toEqual(["src/foo.ts"]);
  });

  test("marks workspace file checks as unscored", () => {
    const doctor = {
      repoExists: true,
      manifest: true,
      baseCheckout: { clean: true, dirtyFiles: [], behindOrigin: 0 },
      validationTools: [],
    };
    const factors = projectHealthFactors({ hasManifest: true }, doctor, {
      workspaceFiles: {
        trackedGeneratedFiles: [".gojo/handoff.json"],
        unignoredGeneratedFiles: [],
        untrackedRegistrationFiles: [],
      },
    });
    const generated = factors.find((factor) => factor.id === "workspace-generated");
    expect(generated?.scored).toBe(false);
    expect(generated?.ok).toBe(false);
    expect(computeProjectHealth({ hasManifest: true }, doctor).score).toBe(100);
  });

  test("returns path-missing summary without factor score fold", () => {
    const health = computeProjectHealth(
      { hasManifest: true },
      {
        repoExists: false,
        manifest: false,
        baseCheckout: { clean: true, behindOrigin: null },
        validationTools: [],
      },
    );
    expect(health).toEqual({ score: 0, level: "warn", label: "0 · path missing" });
  });
});
