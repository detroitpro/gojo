#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const selfPath = resolve(fileURLToPath(import.meta.url));

function which(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function exec(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function findBun() {
  const fromPath = which("bun");
  if (fromPath) {
    return fromPath;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    const candidate = join(home, ".bun", "bin", "bun");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveCliSource() {
  if (process.env.GOJO_CLI_SOURCE) {
    return process.env.GOJO_CLI_SOURCE;
  }

  const repoRoot = join(dirname(selfPath), "../..");
  const candidates = [
    join(repoRoot, "src/cli/index.ts"),
    join(dirname(selfPath), "../../src/cli/index.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function printInstallInstructions() {
  console.error(`gojo bootstrap could not find a runnable CLI.

Options:
  1. Install Bun: https://bun.sh
     Then from the gojo repo: bun install && bun run build
  2. Build the native binary: bun run build
     Ensure bin/gojo is on your PATH
  3. Point directly at a binary: export GOJO_BIN=/path/to/gojo
  4. Point at source entry: export GOJO_CLI_SOURCE=/path/to/gojo/src/cli/index.ts

For development from this repo:
  bun run gojo --help
`);
  process.exit(1);
}

if (process.env.GOJO_BIN) {
  exec(process.env.GOJO_BIN, args);
}

const gojoOnPath = which("gojo");
if (gojoOnPath && resolve(gojoOnPath) !== selfPath) {
  exec(gojoOnPath, args);
}

const bunPath = findBun();
const cliSource = resolveCliSource();
if (bunPath && cliSource) {
  exec(bunPath, [cliSource, ...args]);
}

printInstallInstructions();
