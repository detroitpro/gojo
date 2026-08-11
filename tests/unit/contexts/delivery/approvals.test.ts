import { describe, expect, test } from "bun:test";

import { getApprovalQuery } from "@/contexts/delivery/application/get-approval";
import { listApprovalsQuery } from "@/contexts/delivery/application/list-approvals";
import { listIntegrationsQuery } from "@/contexts/delivery/application/list-integrations";
import { setApprovalAutonomyCommand } from "@/contexts/delivery/application/set-approval-autonomy";
import { submitApprovalIntentCommand } from "@/contexts/delivery/application/submit-approval-intent";
import { runApproveCommand, runRejectCommand } from "@/contexts/delivery/application/run-approve";
import { submitControlIntentCommand } from "@/contexts/delivery/application/submit-control-intent";
import type {
  ApprovalDetail,
  ApprovalPage,
  ApprovalStore,
  IntegrationsPage,
} from "@/contexts/delivery/ports/approval-store";
import type {
  Approval,
  ApprovalAutonomy,
  ControlIntent,
  SubmitControlIntent,
} from "@shared/approvals";

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "approval-1",
    projectId: "proj-1",
    runId: "run-1",
    workItemId: "work-1",
    subjectType: "pull-request",
    subjectId: "subject-1",
    reason: "",
    state: "pending-review",
    autonomy: "manual",
    checksState: null,
    reviewVerdict: null,
    evidence: {},
    decidedBy: null,
    decidedVia: null,
    note: null,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Approval;
}

class MemoryApprovalStore implements ApprovalStore {
  approvals = new Map<string, Approval>();
  intents: SubmitControlIntent[] = [];
  revokedTokens: Array<{ userId: string; tokenId: string }> = [];
  runs = new Map<string, { id: string; state: string }>();
  runApprovals: string[] = [];
  runRejections: Array<{ id: string; reason?: string | null }> = [];
  submitIntentImpl: (input: SubmitControlIntent) => Promise<ControlIntent> = async (
    input,
  ) => ({
    id: "intent-1",
    projectId: input.projectId,
    kind: input.kind,
    targetType: input.targetType,
    targetId: input.targetId,
    actor: input.actor,
    surface: input.surface,
    surfaceRef: input.surfaceRef ?? null,
    note: input.note ?? null,
    state: "applied",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    error: null,
  } as unknown as ControlIntent);

  listApprovals(): ApprovalPage {
    const items = Array.from(this.approvals.values()).map((a) => ({
      ...a,
      workTitle: null,
      workUrl: null,
      agentName: null,
      projectName: null,
      agentAutonomy: null,
      autonomyMismatch: false,
    }));
    return { items, total: items.length, limit: 20, offset: 0 };
  }

  findApprovalDetail(id: string): ApprovalDetail | null {
    const approval = this.approvals.get(id);
    if (!approval) return null;
    return { ...approval, workTitle: null, workUrl: null };
  }

  findApproval(id: string): Approval | null {
    return this.approvals.get(id) ?? null;
  }

  async submitIntent(input: SubmitControlIntent): Promise<ControlIntent> {
    this.intents.push(input);
    return this.submitIntentImpl(input);
  }

  async setAutonomy(id: string, autonomy: ApprovalAutonomy): Promise<Approval> {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error("Approval not found");
    const updated = { ...approval, autonomy } as Approval;
    this.approvals.set(id, updated);
    return updated;
  }

  revokeApprovalToken(userId: string, tokenId: string): void {
    this.revokedTokens.push({ userId, tokenId });
  }

  listIntegrations(
    _input: Parameters<ApprovalStore["listIntegrations"]>[0],
  ): IntegrationsPage {
    return { items: [], total: 0, limit: _input.limit, offset: _input.offset };
  }

  async approveRun(runId: string): Promise<void> {
    this.runApprovals.push(runId);
  }

  async rejectRun(runId: string, reason?: string | null): Promise<void> {
    this.runRejections.push({ id: runId, reason: reason ?? null });
  }

  findRun(runId: string) {
    return this.runs.get(runId) ?? null;
  }
}

describe("contexts/delivery approval use cases", () => {
  test("listApprovalsQuery returns store page", async () => {
    const store = new MemoryApprovalStore();
    store.approvals.set("approval-1", makeApproval());
    const result = await listApprovalsQuery(
      { store },
      { limit: 20, offset: 0 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.id).toBe("approval-1");
    }
  });

  test("getApprovalQuery returns 404 for missing approval", async () => {
    const store = new MemoryApprovalStore();
    const result = await getApprovalQuery({ store }, { id: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.status).toBe(404);
    }
  });

  test("getApprovalQuery returns detail when present", async () => {
    const store = new MemoryApprovalStore();
    store.approvals.set("approval-1", makeApproval());
    const result = await getApprovalQuery({ store }, { id: "approval-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("approval-1");
    }
  });

  test("submitApprovalIntentCommand returns 404 for missing approval", async () => {
    const store = new MemoryApprovalStore();
    const result = await submitApprovalIntentCommand(
      { store },
      {
        approvalId: "missing",
        action: "approve",
        actor: "alice",
        surface: "cli",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  test("submitApprovalIntentCommand submits intent and revokes token on approve", async () => {
    const store = new MemoryApprovalStore();
    store.approvals.set("approval-1", makeApproval());
    const result = await submitApprovalIntentCommand(
      { store },
      {
        approvalId: "approval-1",
        action: "approve",
        actor: "alice",
        surface: "api",
        revokeAfterApprove: { userId: "user-1", tokenId: "tok-1" },
      },
    );
    expect(result.ok).toBe(true);
    expect(store.intents).toHaveLength(1);
    expect(store.intents[0]?.kind).toBe("approve");
    expect(store.revokedTokens).toEqual([{ userId: "user-1", tokenId: "tok-1" }]);
  });

  test("submitApprovalIntentCommand surfaces rejection conflict", async () => {
    const store = new MemoryApprovalStore();
    store.approvals.set("approval-1", makeApproval());
    store.submitIntentImpl = async (input) => ({
      id: "intent-x",
      projectId: input.projectId,
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      actor: input.actor,
      surface: input.surface,
      surfaceRef: input.surfaceRef ?? null,
      note: input.note ?? null,
      state: "rejected",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      error: "checks failing",
    } as unknown as ControlIntent);
    const result = await submitApprovalIntentCommand(
      { store },
      {
        approvalId: "approval-1",
        action: "reject",
        actor: "alice",
        surface: "cli",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
      expect(result.error.status).toBe(409);
      expect(result.error.message).toBe("checks failing");
    }
  });

  test("setApprovalAutonomyCommand rejects invalid autonomy", async () => {
    const store = new MemoryApprovalStore();
    store.approvals.set("approval-1", makeApproval());
    const result = await setApprovalAutonomyCommand(
      { store },
      { id: "approval-1", autonomy: "not-a-thing" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  test("setApprovalAutonomyCommand updates approval", async () => {
    const store = new MemoryApprovalStore();
    store.approvals.set("approval-1", makeApproval({ autonomy: "manual" }));
    const result = await setApprovalAutonomyCommand(
      { store },
      { id: "approval-1", autonomy: "auto" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.approval.autonomy).toBe("auto");
    expect(store.approvals.get("approval-1")?.autonomy).toBe("auto");
  });

  test("submitControlIntentCommand rejects invalid payloads", async () => {
    const store = new MemoryApprovalStore();
    const result = await submitControlIntentCommand({ store }, { projectId: "p" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.status).toBe(400);
    }
  });

  test("listIntegrationsQuery rejects unknown status", async () => {
    const store = new MemoryApprovalStore();
    const result = await listIntegrationsQuery(
      { store },
      { status: "closed", limit: 25, offset: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  test("listIntegrationsQuery defaults omitted status to all", async () => {
    const store = new MemoryApprovalStore();
    let capturedStatus = "";
    let capturedSort = "";
    store.listIntegrations = ((input: Parameters<ApprovalStore["listIntegrations"]>[0]) => {
      capturedStatus = input.status;
      capturedSort = input.sort;
      return { items: [], total: 0, limit: input.limit, offset: input.offset };
    }) as ApprovalStore["listIntegrations"];
    const result = await listIntegrationsQuery(
      { store },
      { status: null, limit: 25, offset: 0 },
    );
    expect(result.ok).toBe(true);
    expect(capturedStatus).toBe("all");
    expect(capturedSort).toBe("activityAt");
  });

  test("listIntegrationsQuery defaults sort/order per status", async () => {
    const store = new MemoryApprovalStore();
    let capturedSort = "";
    let capturedOrder = "";
    store.listIntegrations = ((input: Parameters<ApprovalStore["listIntegrations"]>[0]) => {
      capturedSort = input.sort;
      capturedOrder = input.order;
      return { items: [], total: 0, limit: input.limit, offset: input.offset };
    }) as ApprovalStore["listIntegrations"];
    const result = await listIntegrationsQuery(
      { store },
      { status: "merged", limit: 25, offset: 0 },
    );
    expect(result.ok).toBe(true);
    expect(capturedSort).toBe("mergedAt");
    expect(capturedOrder).toBe("desc");
  });

  test("runApproveCommand approves existing run", async () => {
    const store = new MemoryApprovalStore();
    store.runs.set("run-1", { id: "run-1", state: "AwaitingApproval" });
    store.findRun = (runId) => {
      const run = store.runs.get(runId);
      if (!run) return null;
      if (store.runApprovals.includes(runId)) {
        return { ...run, state: "Approved" };
      }
      return run;
    };
    const result = await runApproveCommand({ store }, { id: "run-1" });
    expect(result.ok).toBe(true);
    expect(store.runApprovals).toEqual(["run-1"]);
    if (result.ok) expect(result.value.run?.state).toBe("Approved");
  });

  test("runRejectCommand returns 404 when run missing", async () => {
    const store = new MemoryApprovalStore();
    const result = await runRejectCommand(
      { store },
      { id: "missing", reason: "checks failed" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.status).toBe(404);
    }
    expect(store.runRejections).toHaveLength(0);
  });
});
