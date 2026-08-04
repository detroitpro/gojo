/** Operations SQLite audit repository. */
import { ulid } from "ulid";

import type { Database } from "@/infrastructure/persistence/db";
import type { AuditEvent, CreateAuditEventInput } from "@/infrastructure/persistence/types";

function nowIso(): string {
  return new Date().toISOString();
}

function boolFromInt(value: number): boolean {
  return value !== 0;
}

function intFromBool(value: boolean): number {
  return value ? 1 : 0;
}


interface AuditEventRow {
  id: string;
  actor: string;
  action: string;
  target: string;
  previous_json: string | null;
  new_json: string | null;
  source_ip: string | null;
  auth_method: string | null;
  correlation_id: string | null;
  success: number;
  created_at: string;
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    previousJson: row.previous_json,
    newJson: row.new_json,
    sourceIp: row.source_ip,
    authMethod: row.auth_method,
    correlationId: row.correlation_id,
    success: boolFromInt(row.success),
    createdAt: row.created_at,
  };
}


export interface AuditRepository {
  create(input: CreateAuditEventInput): AuditEvent;
  findById(id: string): AuditEvent | null;
  listByTarget(target: string, limit?: number): AuditEvent[];
}


export function createAuditRepository(db: Database): AuditRepository {
  const sqlite = db.connection();

  const audit: AuditRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();
      const success = input.success ?? true;

      sqlite
        .query(
          `INSERT INTO audit_events (
            id, actor, action, target, previous_json, new_json, source_ip,
            auth_method, correlation_id, success, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.actor,
          input.action,
          input.target,
          input.previousJson ?? null,
          input.newJson ?? null,
          input.sourceIp ?? null,
          input.authMethod ?? null,
          input.correlationId ?? null,
          intFromBool(success),
          createdAt,
        );

      return mapAuditEvent({
        id,
        actor: input.actor,
        action: input.action,
        target: input.target,
        previous_json: input.previousJson ?? null,
        new_json: input.newJson ?? null,
        source_ip: input.sourceIp ?? null,
        auth_method: input.authMethod ?? null,
        correlation_id: input.correlationId ?? null,
        success: intFromBool(success),
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite
        .query<AuditEventRow, [string]>("SELECT * FROM audit_events WHERE id = ?")
        .get(id);
      return row ? mapAuditEvent(row) : null;
    },

    listByTarget(target, limit = 100) {
      const rows = sqlite
        .query<AuditEventRow, [string, number]>(
          "SELECT * FROM audit_events WHERE target = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(target, limit);
      return rows.map(mapAuditEvent);
    },
  };


  return audit;
}
