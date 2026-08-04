/** Access SQLite secret records repository. */
import { ulid } from "ulid";

import type { Database } from "@/infrastructure/persistence/db";
import type { SecretRecord, UpsertSecretInput } from "@/infrastructure/persistence/types";

function nowIso(): string {
  return new Date().toISOString();
}


interface SecretRow {
  id: string;
  name: string;
  project_id: string | null;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

function mapSecret(row: SecretRow): SecretRecord {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    ciphertext: row.ciphertext,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


export interface SecretRepository {
  upsert(input: UpsertSecretInput): SecretRecord;
  findByName(name: string, projectId?: string | null): SecretRecord | null;
  deleteByName(name: string, projectId?: string | null): boolean;
  list(): SecretRecord[];
}


export function createSecretRepository(db: Database): SecretRepository {
  const sqlite = db.connection();

  const secrets: SecretRepository = {
    upsert(input) {
      const existing = this.findByName(input.name, input.projectId ?? null);
      const now = nowIso();

      if (existing) {
        sqlite
          .query("UPDATE secrets SET ciphertext = ?, updated_at = ? WHERE id = ?")
          .run(input.ciphertext, now, existing.id);
        return mapSecret({
          id: existing.id,
          name: input.name,
          project_id: input.projectId ?? null,
          ciphertext: input.ciphertext,
          created_at: existing.createdAt,
          updated_at: now,
        });
      }

      const id = ulid();
      sqlite
        .query(
          `INSERT INTO secrets (id, name, project_id, ciphertext, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.name, input.projectId ?? null, input.ciphertext, now, now);

      return mapSecret({
        id,
        name: input.name,
        project_id: input.projectId ?? null,
        ciphertext: input.ciphertext,
        created_at: now,
        updated_at: now,
      });
    },

    findByName(name, projectId = null) {
      const row =
        projectId === null || projectId === undefined
          ? sqlite
              .query<SecretRow, [string]>(
                "SELECT * FROM secrets WHERE name = ? AND project_id IS NULL",
              )
              .get(name)
          : sqlite
              .query<SecretRow, [string, string]>(
                "SELECT * FROM secrets WHERE name = ? AND project_id = ?",
              )
              .get(name, projectId);
      return row ? mapSecret(row) : null;
    },

    deleteByName(name, projectId = null) {
      const result =
        projectId === null || projectId === undefined
          ? sqlite
              .query("DELETE FROM secrets WHERE name = ? AND project_id IS NULL")
              .run(name)
          : sqlite
              .query("DELETE FROM secrets WHERE name = ? AND project_id = ?")
              .run(name, projectId);
      return result.changes > 0;
    },

    list() {
      const rows = sqlite
        .query<SecretRow, []>("SELECT * FROM secrets ORDER BY name, project_id")
        .all();
      return rows.map(mapSecret);
    },
  };


  return secrets;
}
