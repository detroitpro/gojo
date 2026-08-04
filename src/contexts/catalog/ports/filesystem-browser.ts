import type { DirectoryListing } from "@/infrastructure/filesystem/browse";

/** Port over the filesystem repo picker. */
export interface FilesystemBrowserPort {
  browse(path: string | null): DirectoryListing;
  roots(): Array<{ label: string; path: string }>;
}
