/** Read-only host-filesystem browsing for the UI. */
export interface FilesystemBrowser {
  browse(path: string | null): { listing: { path: string; entries: unknown[] }; roots: unknown[] };
}
