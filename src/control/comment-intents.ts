import type { Database } from "@/storage";
import type {
  ProjectSource,
  SourceConnection,
} from "@/storage";
import type { WorkItem } from "@shared/work";
import { parseJsonObject } from "@shared/json";
import type { SourceAdapter } from "@/sources";
import type { NormalizedSourceComment } from "@/sources/write-types";

import type { ApprovalService } from "./service";

export interface CommentIntentObservation {
  source: ProjectSource;
  connection: SourceConnection;
  adapter: SourceAdapter;
  token: string | null;
  workItem: WorkItem;
}

const COMMAND =
  /^\/gojo\s+(approve|merge|reject|hold|claim)(?:\s+([\s\S]+))?$/i;

function trustedActors(connection: SourceConnection): Set<string> {
  const configured = parseJsonObject(connection.configJson)["controlTrustedActors"];
  return new Set(
    Array.isArray(configured)
      ? configured
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.toLowerCase())
      : [],
  );
}

export class CommentIntentService {
  private readonly sqlite;
  private readonly approvals: ApprovalService;
  private readonly resolveTrustedActors: (projectId: string) => string[];
  private readonly claim: (
    workItem: WorkItem,
    agentName: string,
  ) => Promise<string | null>;

  constructor(input: {
    db: Database;
    approvals: ApprovalService;
    resolveTrustedActors?: (projectId: string) => string[];
    claim?: (workItem: WorkItem, agentName: string) => Promise<string | null>;
  }) {
    this.sqlite = input.db.connection();
    this.approvals = input.approvals;
    this.resolveTrustedActors = input.resolveTrustedActors ?? (() => []);
    this.claim = input.claim ?? (async () => null);
  }

  async observe(input: CommentIntentObservation): Promise<number> {
    if (
      (input.workItem.kind !== "pull-request" &&
        input.workItem.kind !== "issue") ||
      !input.adapter.listComments ||
      !input.workItem.nativeKey
    ) {
      return 0;
    }
    const trusted = trustedActors(input.connection);
    for (const actor of this.resolveTrustedActors(input.workItem.projectId)) {
      trusted.add(actor.toLowerCase());
    }
    if (trusted.size === 0) return 0;
    const comments = await this.fetchComments(input);
    if (comments.length === 0) return 0;
    const cursor = this.sqlite
      .query<{ last_comment_id: string | null }, [string]>(
        "SELECT last_comment_id FROM source_comment_cursors WHERE work_item_id = ?",
      )
      .get(input.workItem.id)?.last_comment_id;
    const cursorIndex = cursor
      ? comments.findIndex((comment) => comment.id === cursor)
      : -1;
    const unseen = cursorIndex >= 0 ? comments.slice(cursorIndex + 1) : comments;
    const approval = this.approvals.findBySubject(
      "pull-request",
      input.workItem.id,
    );
    let applied = 0;
    for (const comment of unseen) {
      if (!comment.actor || !trusted.has(comment.actor.toLowerCase())) continue;
      const command = comment.body.trim().match(COMMAND);
      if (!command) continue;
      const requested = command[1]?.toLowerCase();
      if (requested === "claim") {
        const agentName = command[2]?.trim();
        if (input.workItem.kind !== "issue" || !agentName) continue;
        const runId = await this.claim(input.workItem, agentName);
        const intent = this.approvals.recordIntent(
          {
            projectId: input.workItem.projectId,
            kind: "claim",
            targetType: "work-item",
            targetId: input.workItem.id,
            actor: comment.actor,
            surface: "forge-comment",
            surfaceRef: `${input.source.id}:${comment.id}`,
            note: agentName,
          },
          runId ? "applied" : "rejected",
          runId ? null : `Agent not found or ineligible: ${agentName}`,
        );
        if (intent.state === "applied") {
          applied += 1;
          const operation = {
            baseUrl: input.connection.baseUrl ?? "",
            externalKey: input.source.externalKey,
            kind: "issue" as const,
            nativeKey: input.workItem.nativeKey,
            token: input.token,
          };
          await input.adapter.setLabels?.({
            ...operation,
            add: ["gojo:in-progress"],
          });
          await input.adapter.comment?.({
            ...operation,
            body: `Gojo claimed this issue for ${agentName}. Run: ${runId}`,
          });
        }
        continue;
      }
      if (!approval) continue;
      const intent = await this.approvals.submitIntent({
        projectId: input.workItem.projectId,
        kind:
          requested === "approve" || requested === "merge"
            ? "approve"
            : requested === "reject"
              ? "reject"
              : "hold",
        targetType: "approval",
        targetId: approval.id,
        actor: comment.actor,
        surface: "forge-comment",
        surfaceRef: `${input.source.id}:${comment.id}`,
        ...(command[2]?.trim() ? { note: command[2].trim() } : {}),
      });
      if (intent.state === "applied") applied += 1;
    }
    const last = comments.at(-1);
    if (last) {
      this.sqlite
        .query(
          `INSERT INTO source_comment_cursors (
             work_item_id, source_id, last_comment_id, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(work_item_id) DO UPDATE SET
             source_id = excluded.source_id,
             last_comment_id = excluded.last_comment_id,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.workItem.id,
          input.source.id,
          last.id,
          new Date().toISOString(),
        );
    }
    return applied;
  }

  private async fetchComments(
    input: CommentIntentObservation,
  ): Promise<NormalizedSourceComment[]> {
    if (!input.adapter.listComments || !input.workItem.nativeKey) return [];
    return input.adapter.listComments({
      baseUrl: input.connection.baseUrl ?? "",
      externalKey: input.source.externalKey,
      kind: input.workItem.kind === "issue" ? "issue" : "pull-request",
      nativeKey: input.workItem.nativeKey,
      token: input.token,
    });
  }
}
