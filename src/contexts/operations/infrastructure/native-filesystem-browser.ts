import { browseRoots, listDirectory } from "@/infrastructure/filesystem/browse";

import type { FilesystemBrowser } from "../ports/filesystem-browser";

export class NativeFilesystemBrowser implements FilesystemBrowser {
  browse(path: string | null): {
    listing: { path: string; entries: unknown[] };
    roots: unknown[];
  } {
    const listing = listDirectory(path);
    return { listing, roots: browseRoots() };
  }
}
