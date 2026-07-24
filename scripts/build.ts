#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const binDir = join(root, "bin");
const cliEntry = join(root, "src/cli/index.ts");
const outPath = join(binDir, "gojo");
const webDir = join(root, "web");
const webPackageJson = join(webDir, "package.json");

mkdirSync(binDir, { recursive: true });

if (existsSync(webPackageJson)) {
  const webNodeModules = join(webDir, "node_modules");
  if (!existsSync(webNodeModules)) {
    console.log("Skipping web build (run `bun install` in web/ first).");
  } else {
    console.log("Building web UI...");
    const webBuild = Bun.spawn(["bun", "run", "--cwd", webDir, "build"], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const webExit = await webBuild.exited;
    if (webExit !== 0) {
      console.warn("Web build failed; continuing with CLI compile only.");
    }
  }
} else {
  console.log("Skipping web build (web/package.json not found).");
}

console.log("Compiling gojo CLI for current platform...");
const compile = Bun.spawn(
  ["bun", "build", cliEntry, "--compile", "--outfile", outPath],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  },
);
const compileExit = await compile.exited;
if (compileExit !== 0) {
  process.exit(compileExit ?? 1);
}

const webDist = join(webDir, "dist");
if (existsSync(webDist)) {
  const bundledDist = join(binDir, "web", "dist");
  mkdirSync(dirname(bundledDist), { recursive: true });
  cpSync(webDist, bundledDist, { recursive: true });
  console.log(`Bundled web assets -> ${bundledDist}`);
}

console.log(`Built ${outPath}`);
console.log("");
console.log("Cross-compile targets (run from repo root):");
console.log("  bun build src/cli/index.ts --compile --target=bun-linux-x64 --outfile bin/gojo-linux-x64");
console.log("  bun build src/cli/index.ts --compile --target=bun-linux-arm64 --outfile bin/gojo-linux-arm64");
console.log("  bun build src/cli/index.ts --compile --target=bun-darwin-x64 --outfile bin/gojo-darwin-x64");
console.log("  bun build src/cli/index.ts --compile --target=bun-darwin-arm64 --outfile bin/gojo-darwin-arm64");
console.log("");
console.log("Compiled binaries resolve web/dist from:");
console.log("  - GOJO_WEB_DIST");
console.log("  - web/dist next to the executable (copied by this script)");
console.log("  - ~/.gojo/web/dist or $GOJO_HOME/web/dist");
