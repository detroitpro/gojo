import { browseRoots, listDirectory, type DirectoryListing } from "@/infrastructure/filesystem/browse";

import type { FilesystemBrowserPort } from "../ports/filesystem-browser";

export class NodeFilesystemBrowser implements FilesystemBrowserPort {
  browse(path: string | null): DirectoryListing {
    return listDirectory(path);
  }

  roots(): Array<{ label: string; path: string }> {
    return browseRoots();
  }
}
