import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { FilesystemBrowserPort } from "../ports/filesystem-browser";

export type BrowseFilesystemInput = {
  path?: string | null;
};

export async function browseFilesystemQuery(
  browser: FilesystemBrowserPort,
  input: BrowseFilesystemInput,
): Promise<Result<{ listing: unknown; roots: unknown }, UseCaseFailure>> {
  try {
    const listing = browser.browse(input.path ?? null);
    return ok({ listing, roots: browser.roots() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return useCaseFailure("validation_error", message, 400);
  }
}
