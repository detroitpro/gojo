import { err, ok, type Result } from "@/kernel";

import type { FilesystemBrowser } from "../ports/filesystem-browser";

export type FilesystemDeps = { browser: FilesystemBrowser };

export async function browseFilesystemQuery(
  deps: FilesystemDeps,
  input: { path?: string | null },
): Promise<Result<{ listing: { path: string; entries: unknown[] }; roots: unknown[] }>> {
  try {
    return ok(deps.browser.browse(input.path ?? null));
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
