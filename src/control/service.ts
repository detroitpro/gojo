import type {
  Approval,
  ApprovalAutonomy,
  ChecksState,
  ControlIntent,
  CreateApproval,
  ReviewVerdict,
  SubmitControlIntent,
} from '@shared/approvals';
import {
  createApprovalRepository,
  createControlIntentRepository,
} from '@/storage/approval-repositories';
import type { Database } from '@/storage/db';

export interface MergeResult {
  status: 'merged' | 'scheduled' | 'blocked';
  detail?: string | null;
}

export type MergeApproval = (approval: Approval) => Promise<MergeResult>;

export class ApprovalService {
  private readonly approvals;
  private readonly intents;
  private readonly merge: MergeApproval;
  private readonly onChange: ((approval: Approval) => void) | null;

  constructor(input: {
    db: Database;
    merge: MergeApproval;
    onChange?: (approval: Approval) => void;
  }) {
    this.approvals = createApprovalRepository(input.db);
    this.intents = createControlIntentRepository(input.db);
    this.merge = input.merge;
    this.onChange = input.onChange ?? null;
  }

  create(input: CreateApproval): Approval {
    const approval = this.approvals.create(input);
    this.onChange?.(approval);
    return approval;
  }

  findById(id: string): Approval | null {
    return this.approvals.findById(id);
  }

  findByRun(runId: string): Approval | null {
    return this.approvals.findByRun(runId);
  }

  findBySubject(subjectType: string, subjectId: string): Approval | null {
    return this.approvals.findBySubject(subjectType, subjectId);
  }

  list(input: Parameters<typeof this.approvals.list>[0]) {
    return this.approvals.list(input);
  }

  beginFixRound(
    approvalId: string,
    evidence: Record<string, unknown>,
  ): Approval {
    const approval = this.requireApproval(approvalId);
    const updated = this.approvals.update(approval.id, {
      runId: null,
      state: 'pending-review',
      checksState: 'pending',
      reviewVerdict: null,
      attempts: approval.attempts + 1,
      evidence: { ...approval.evidence, lastFix: evidence },
      lastError: null,
    })!;
    this.onChange?.(updated);
    return updated;
  }

  assignRun(approvalId: string, runId: string): Approval {
    const updated = this.approvals.update(approvalId, { runId });
    if (!updated) throw new Error(`Approval not found: ${approvalId}`);
    this.onChange?.(updated);
    return updated;
  }

  attachWorkItem(approvalId: string, workItemId: string): Approval {
    const updated = this.approvals.update(approvalId, { workItemId });
    if (!updated) throw new Error(`Approval not found: ${approvalId}`);
    this.onChange?.(updated);
    return updated;
  }

  /**
   * Update snapshotted autonomy (e.g. after flipping agent `approval:` in the
   * manifest) and re-run advance when checks/review already allow merge.
   */
  async setAutonomy(
    approvalId: string,
    autonomy: ApprovalAutonomy,
  ): Promise<Approval> {
    const approval = this.requireApproval(approvalId);
    const updated = this.approvals.update(approval.id, {
      autonomy,
      lastError: null,
    })!;
    this.onChange?.(updated);
    return this.advance(updated);
  }

  /** Merge keys into approval evidence without changing state. */
  patchEvidence(
    approvalId: string,
    evidence: Record<string, unknown>,
  ): Approval {
    const approval = this.requireApproval(approvalId);
    const updated = this.approvals.update(approval.id, {
      evidence: { ...approval.evidence, ...evidence },
    })!;
    this.onChange?.(updated);
    return updated;
  }

  escalate(
    approvalId: string,
    reason: string,
    evidence: Record<string, unknown> = {},
  ): Approval {
    const approval = this.requireApproval(approvalId);
    const updated = this.approvals.update(approval.id, {
      state: 'awaiting-human',
      evidence: { ...approval.evidence, escalation: evidence },
      lastError: reason,
    })!;
    this.onChange?.(updated);
    return updated;
  }

  async recordChecks(
    approvalId: string,
    checksState: ChecksState,
    evidence: Record<string, unknown> = {},
  ): Promise<Approval> {
    const approval = this.requireApproval(approvalId);
    const updated = this.approvals.update(approval.id, {
      checksState,
      evidence: { ...approval.evidence, checks: evidence },
      ...(checksState === 'failure'
        ? { state: 'failed' as const, lastError: 'Required checks failed' }
        : {}),
    })!;
    const advanced = await this.advance(updated);
    this.onChange?.(advanced);
    return advanced;
  }

  async recordReview(
    approvalId: string,
    verdict: ReviewVerdict,
    evidence: Record<string, unknown> = {},
  ): Promise<Approval> {
    const approval = this.requireApproval(approvalId);
    const updated = this.approvals.update(approval.id, {
      reviewVerdict: verdict,
      evidence: { ...approval.evidence, review: evidence },
      ...(verdict !== 'pass'
        ? {
            state: 'failed' as const,
            lastError:
              verdict === 'changes-requested'
                ? 'Reviewer requested changes'
                : 'Reviewer rejected the change',
          }
        : {}),
    })!;
    const advanced = await this.advance(updated);
    this.onChange?.(advanced);
    return advanced;
  }

  async submitIntent(input: SubmitControlIntent): Promise<ControlIntent> {
    if (input.surfaceRef) {
      const existing = this.intents.findBySurfaceRef(input.surface, input.surfaceRef);
      if (existing) return existing;
    }

    const approval =
      input.targetType === 'approval' ? this.approvals.findById(input.targetId) : null;
    if (!approval || approval.projectId !== input.projectId) {
      return this.intents.create({
        ...input,
        state: 'rejected',
        error: 'Approval not found',
      });
    }

    if (input.kind === 'reject') {
      const updated = this.approvals.update(approval.id, {
        state: 'rejected',
        decidedBy: input.actor,
        decidedVia: input.surface,
        note: input.note ?? null,
      });
      if (updated) this.onChange?.(updated);
      return this.intents.create({ ...input, state: 'applied' });
    }
    if (input.kind === 'hold') {
      const updated = this.approvals.update(approval.id, {
        state: 'held',
        decidedBy: input.actor,
        decidedVia: input.surface,
        note: input.note ?? null,
      });
      if (updated) this.onChange?.(updated);
      return this.intents.create({ ...input, state: 'applied' });
    }
    if (input.kind !== 'approve') {
      return this.intents.create({
        ...input,
        state: 'rejected',
        error: `Unsupported approval intent: ${input.kind}`,
      });
    }
    if (approval.checksState !== 'success' || approval.reviewVerdict !== 'pass') {
      return this.intents.create({
        ...input,
        state: 'rejected',
        error: 'Approval requires green checks and a passing review',
      });
    }

    this.approvals.update(approval.id, {
      state: 'approved',
      decidedBy: input.actor,
      decidedVia: input.surface,
      note: input.note ?? null,
    });
    const applied = await this.applyMerge(this.requireApproval(approval.id));
    return this.intents.create({
      ...input,
      state: applied.state === 'failed' ? 'failed' : 'applied',
      error: applied.lastError,
    });
  }

  recordIntent(
    input: SubmitControlIntent,
    state: ControlIntent["state"],
    error: string | null = null,
  ): ControlIntent {
    if (input.surfaceRef) {
      const existing = this.intents.findBySurfaceRef(
        input.surface,
        input.surfaceRef,
      );
      if (existing) return existing;
    }
    return this.intents.create({ ...input, state, error });
  }

  private readyToAdvance(approval: Approval): boolean {
    if (approval.checksState !== 'success') {
      return false;
    }
    // Native / policy auto-merge: green checks are enough (no reviewer).
    if (approval.autonomy === 'auto') {
      return true;
    }
    return approval.reviewVerdict === 'pass';
  }

  private async advance(approval: Approval): Promise<Approval> {
    if (!this.readyToAdvance(approval)) {
      return approval;
    }
    if (approval.autonomy === 'manual') {
      const updated = this.approvals.update(approval.id, {
        state: 'awaiting-human',
        lastError: null,
      })!;
      this.onChange?.(updated);
      return updated;
    }
    return this.applyMerge(approval);
  }

  private async applyMerge(approval: Approval): Promise<Approval> {
    if (!this.readyToAdvance(approval)) {
      return approval;
    }
    const applying = this.approvals.update(approval.id, {
      state: 'applying',
      lastError: null,
    })!;
    try {
      const result = await this.merge(applying);
      if (result.status === 'blocked') {
        const blocked = this.approvals.update(approval.id, {
          state: 'failed',
          lastError: result.detail ?? 'Merge was blocked',
        })!;
        this.onChange?.(blocked);
        return blocked;
      }
      const updated = this.approvals.update(approval.id, {
        state: result.status === 'merged' ? 'applied' : 'applying',
        lastError: null,
      })!;
      this.onChange?.(updated);
      return updated;
    } catch (error) {
      const failed = this.approvals.update(approval.id, {
        state: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      })!;
      this.onChange?.(failed);
      return failed;
    }
  }

  private requireApproval(id: string): Approval {
    const approval = this.approvals.findById(id);
    if (!approval) throw new Error(`Approval not found: ${id}`);
    return approval;
  }
}
