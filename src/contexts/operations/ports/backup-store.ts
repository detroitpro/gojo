/** Backup catalog + creation/verification wrappers. */
export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface BackupCreateResult {
  path: string;
  size: number;
  createdAt: string;
}

export interface BackupStore {
  list(): BackupEntry[];
  create(): Promise<BackupCreateResult>;
  verify(rawPath: string): Promise<{ path: string; valid: boolean }>;
}
