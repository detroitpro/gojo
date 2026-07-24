export type OutputFormat = "json" | "text" | "yaml";

export interface ParsedArgv {
  command: string[];
  flags: Record<string, string | boolean>;
  positional: string[];
}

const GLOBAL_FLAGS = new Set(["home", "output", "help", "h"]);

export function parseArgv(argv: string[]): ParsedArgv {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const args = [...argv];

  while (args.length > 0) {
    const current = args[0];
    if (current === undefined) {
      break;
    }

    if (current === "--") {
      args.shift();
      positional.push(...args);
      break;
    }

    if (current.startsWith("--")) {
      const raw = current.slice(2);
      const eqIndex = raw.indexOf("=");
      if (eqIndex >= 0) {
        const key = raw.slice(0, eqIndex);
        const value = raw.slice(eqIndex + 1);
        flags[key] = value;
        args.shift();
        continue;
      }

      const key = raw;
      args.shift();
      const next = args[0];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        args.shift();
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (current.startsWith("-") && current.length > 1) {
      const key = current.slice(1);
      if (key === "h") {
        flags["help"] = true;
        args.shift();
        continue;
      }
      flags[key] = true;
      args.shift();
      continue;
    }

    positional.push(current);
    args.shift();
  }

  const globalFlags: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (GLOBAL_FLAGS.has(key)) {
      globalFlags[key] = value;
    }
  }

  const command = positional.slice(0, 2);
  const rest = positional.slice(2);

  return {
    command,
    flags: { ...globalFlags, ...flags },
    positional: rest,
  };
}

export function getHome(parsed: ParsedArgv): string | undefined {
  const value = parsed.flags["home"];
  return typeof value === "string" ? value : undefined;
}

export function getOutputFormat(parsed: ParsedArgv): OutputFormat {
  const value = parsed.flags["output"];
  if (value === "json" || value === "yaml" || value === "text") {
    return value;
  }
  return "text";
}

export function getFlagString(parsed: ParsedArgv, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function hasFlag(parsed: ParsedArgv, name: string): boolean {
  return parsed.flags[name] === true || typeof parsed.flags[name] === "string";
}
