#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const binDir = join(root, "bin");

interface ManifestFile {
  sha256: string;
  size: number;
}

function sha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

if (!existsSync(binDir)) {
  console.error(`Missing bin directory: ${binDir}`);
  console.error("Run `bun run build` first.");
  process.exit(1);
}

const files: Record<string, ManifestFile> = {};

for (const name of readdirSync(binDir)) {
  if (name === "manifest.json") {
    continue;
  }

  const filePath = join(binDir, name);
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    continue;
  }

  files[name] = {
    sha256: sha256(filePath),
    size: stats.size,
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  version: "0.1.0",
  files,
};

const manifestPath = join(binDir, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${manifestPath} (${Object.keys(files).length} binaries)`);
