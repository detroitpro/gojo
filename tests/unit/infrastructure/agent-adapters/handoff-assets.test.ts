import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeHandoffAssets,
  resolveHandoffAssetContent,
} from "@/infrastructure/agent-adapters/handoff-assets";

describe("resolveHandoffAssetContent", () => {
  test("returns inline content", () => {
    const resolved = resolveHandoffAssetContent("/tmp/ws", {
      role: "pr-body",
      content: "# Hello",
    });
    expect(resolved?.content).toBe("# Hello");
    expect(resolved?.mediaType).toBe("text/markdown");
  });

  test("reads workspace-relative path", () => {
    const root = mkdtempSync(join(tmpdir(), "gojo-handoff-"));
    mkdirSync(join(root, ".gojo", "assets"), { recursive: true });
    writeFileSync(join(root, ".gojo", "assets", "pr-body.md"), "## Body\n", "utf8");
    const resolved = resolveHandoffAssetContent(root, {
      role: "pr-body",
      path: ".gojo/assets/pr-body.md",
    });
    expect(resolved?.content).toBe("## Body\n");
    expect(resolved?.sourcePath).toBe(".gojo/assets/pr-body.md");
  });

  test("rejects path escape outside workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "gojo-handoff-"));
    const resolved = resolveHandoffAssetContent(root, {
      role: "attachment",
      path: "../../../etc/passwd",
    });
    expect(resolved).toBeNull();
  });
});

describe("materializeHandoffAssets", () => {
  test("writes assets under artifactDir/assets with content", () => {
    const root = mkdtempSync(join(tmpdir(), "gojo-ws-"));
    const artifactDir = mkdtempSync(join(tmpdir(), "gojo-art-"));
    mkdirSync(join(root, ".gojo"), { recursive: true });
    writeFileSync(join(root, ".gojo", "body.md"), "verbose pr\n", "utf8");

    const out = materializeHandoffAssets(root, artifactDir, [
      { role: "pr-body", path: ".gojo/body.md", label: "PR" },
      { role: "report", content: "inline report" },
    ]);

    expect(out).toHaveLength(2);
    expect(out[0]!.path.startsWith("assets/")).toBe(true);
    expect(out[0]!.content).toBe("verbose pr\n");
    expect(readFileSync(join(artifactDir, out[0]!.path), "utf8")).toBe("verbose pr\n");
    expect(out[1]!.content).toBe("inline report");
  });
});
