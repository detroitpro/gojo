import type { Database } from "@/infrastructure/persistence/db";

type LeaseRow = { holder: string; expires_at: string };

export function acquireSchedulerLease(
  db: Database,
  leaseId: string,
  holderId: string,
  ttlMs: number,
): boolean {
  const sqlite = db.connection();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const nowIso = new Date().toISOString();

  const existing = sqlite
    .query<LeaseRow, [string]>("SELECT holder, expires_at FROM scheduler_leases WHERE id = ?")
    .get(leaseId);

  if (!existing) {
    sqlite
      .query("INSERT INTO scheduler_leases (id, holder, expires_at) VALUES (?, ?, ?)")
      .run(leaseId, holderId, expiresAt);
    return true;
  }

  if (existing.holder === holderId || existing.expires_at <= nowIso) {
    sqlite
      .query("UPDATE scheduler_leases SET holder = ?, expires_at = ? WHERE id = ?")
      .run(holderId, expiresAt, leaseId);
    return true;
  }

  return false;
}

export function refreshSchedulerLease(
  db: Database,
  leaseId: string,
  holderId: string,
  ttlMs: number,
): boolean {
  const sqlite = db.connection();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const result = sqlite
    .query("UPDATE scheduler_leases SET expires_at = ? WHERE id = ? AND holder = ?")
    .run(expiresAt, leaseId, holderId);

  return result.changes > 0;
}

export function releaseSchedulerLease(db: Database, leaseId: string, holderId: string): void {
  db.connection()
    .query("DELETE FROM scheduler_leases WHERE id = ? AND holder = ?")
    .run(leaseId, holderId);
}
