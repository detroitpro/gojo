import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve the web UI static asset directory.
 *
 * Search order:
 * 1. GOJO_WEB_DIST
 * 2. ../../web/dist relative to this module (source / dev checkout)
 * 3. web/dist next to the running executable (compiled binary layout)
 * 4. ~/.gojo/web/dist and $GOJO_HOME/web/dist
 */
export function resolveWebDistDir(): string | null {
  const fromEnv = process.env["GOJO_WEB_DIST"];
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) {
    return fromEnv;
  }

  const gojoHome = process.env["GOJO_HOME"];
  const homeCandidates = [
    gojoHome !== undefined && gojoHome.length > 0 ? join(gojoHome, "web", "dist") : null,
    join(homedir(), ".gojo", "web", "dist"),
  ].filter((value): value is string => value !== null);

  return firstExisting([
    join(import.meta.dir, "../../web/dist"),
    join(dirname(process.execPath), "web", "dist"),
    ...homeCandidates,
  ]);
}
