import type { AppContext } from "@/platform/app-context";
import {
  createBackup,
  defaultBackupDest,
  listBackups,
  resolveBackupPath,
  verifyBackup,
} from "@/contexts/operations/infrastructure/backup";

import type {
  BackupCreateResult,
  BackupEntry,
  BackupStore,
} from "../ports/backup-store";

export class AppContextBackupStore implements BackupStore {
  constructor(private readonly ctx: AppContext) {}

  list(): BackupEntry[] {
    return listBackups(this.ctx.paths).map((item) => ({
      name: item.name,
      path: item.path,
      size: item.size,
      createdAt: item.createdAt,
    }));
  }

  async create(): Promise<BackupCreateResult> {
    const dest = defaultBackupDest(this.ctx.paths);
    const result = await createBackup(this.ctx.paths, this.ctx.paths.db, dest);
    return {
      path: result.path,
      size: 0,
      createdAt: new Date().toISOString(),
    };
  }

  async verify(rawPath: string): Promise<{ path: string; valid: boolean }> {
    const safePath = resolveBackupPath(this.ctx.paths, rawPath);
    return { path: safePath, valid: await verifyBackup(safePath) };
  }
}
