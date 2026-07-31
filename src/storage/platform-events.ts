import { ulid } from "ulid";

import {
  PlatformChangeEventSchema,
  PlatformEventTopicSchema,
  type CreatePlatformChangeEventInput,
  type PlatformChangeEvent,
  type PlatformEventTopic,
} from "@shared/events";

import type { Database } from "./db";

interface PlatformChangeEventRow {
  sequence: number;
  id: string;
  project_id: string | null;
  type: string;
  entity_kind: string;
  entity_id: string;
  topics_json: string;
  data_json: string;
  occurred_at: string;
  created_at: string;
}

export interface ListPlatformChangeEventsInput {
  afterSequence?: number;
  limit?: number;
  projectId?: string | null;
  topics?: PlatformEventTopic[];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function normalizeLegacyTopics(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return [
    ...new Set(
      value.map((topic) => (topic === "tasks" ? "agents" : topic)),
    ),
  ];
}

function mapEvent(row: PlatformChangeEventRow): PlatformChangeEvent {
  return PlatformChangeEventSchema.parse({
    sequence: row.sequence,
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    topics: normalizeLegacyTopics(parseJson(row.topics_json)),
    data: parseJson(row.data_json),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  });
}

export function createPlatformChangeEventRepository(db: Database) {
  const sqlite = db.connection();

  return {
    append(input: CreatePlatformChangeEventInput): PlatformChangeEvent {
      const id = ulid();
      const createdAt = new Date().toISOString();
      const topics = PlatformEventTopicSchema.array().min(1).parse(input.topics);
      sqlite
        .query(
          `INSERT INTO platform_change_events (
            id, project_id, type, entity_kind, entity_id, topics_json,
            data_json, occurred_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId ?? null,
          input.type,
          input.entityKind,
          input.entityId,
          JSON.stringify([...new Set(topics)]),
          JSON.stringify(input.data ?? {}),
          input.occurredAt ?? createdAt,
          createdAt,
        );
      return mapEvent(
        sqlite
          .query<PlatformChangeEventRow, [string]>(
            "SELECT * FROM platform_change_events WHERE id = ?",
          )
          .get(id)!,
      );
    },

    list(input: ListPlatformChangeEventsInput = {}): PlatformChangeEvent[] {
      const clauses = ["sequence > ?"];
      const values: Array<string | number> = [input.afterSequence ?? 0];
      if (input.projectId !== undefined) {
        if (input.projectId === null) {
          clauses.push("project_id IS NULL");
        } else {
          clauses.push("project_id = ?");
          values.push(input.projectId);
        }
      }
      if (input.topics?.length) {
        const placeholders = input.topics.map(() => "?").join(", ");
        clauses.push(
          `EXISTS (
            SELECT 1 FROM json_each(platform_change_events.topics_json)
            WHERE value IN (${placeholders})
          )`,
        );
        values.push(...input.topics);
      }
      const limit = Math.max(1, Math.min(input.limit ?? 500, 1000));
      return sqlite
        .query<PlatformChangeEventRow, Array<string | number>>(
          `SELECT * FROM platform_change_events
           WHERE ${clauses.join(" AND ")}
           ORDER BY sequence
           LIMIT ?`,
        )
        .all(...values, limit)
        .map(mapEvent);
    },

    pruneThrough(sequence: number): number {
      return sqlite
        .query("DELETE FROM platform_change_events WHERE sequence <= ?")
        .run(sequence).changes;
    },

    pruneBefore(createdAt: string): number {
      return sqlite
        .query("DELETE FROM platform_change_events WHERE created_at < ?")
        .run(createdAt).changes;
    },

    pruneToLatest(limit: number): number {
      const keep = Math.max(1, Math.floor(limit));
      return sqlite
        .query(
          `DELETE FROM platform_change_events
           WHERE sequence < (
             SELECT sequence FROM platform_change_events
             ORDER BY sequence DESC
             LIMIT 1 OFFSET ?
           )`,
        )
        .run(keep - 1).changes;
    },
  };
}

export type PlatformChangeEventRepository = ReturnType<
  typeof createPlatformChangeEventRepository
>;
