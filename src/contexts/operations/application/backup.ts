import { err, ok, type Result } from "@/kernel";

import type { BackupCreateResult, BackupEntry, BackupStore } from "../ports/backup-store";

export type BackupDeps = { store: BackupStore };

export async function listBackupsQuery(
  deps: BackupDeps,
): Promise<Result<BackupEntry[]>> {
  return ok(deps.store.list());
}

export async function createBackupCommand(
  deps: BackupDeps,
): Promise<Result<BackupCreateResult>> {
  try {
    return ok(await deps.store.create());
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export async function verifyBackupCommand(
  deps: BackupDeps,
  input: { path: string },
): Promise<Result<{ path: string; valid: boolean }>> {
  try {
    return ok(await deps.store.verify(input.path));
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
