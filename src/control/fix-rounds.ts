import type { Approval } from '@shared/approvals';
import type { NormalizedSourceCheck } from '@/sources';

/** Max characters for a single check's details in fix-round feedback. */
const MAX_CHECK_DETAILS_CHARS = 800;
/** Max characters for the whole checksSummary string. */
const MAX_CHECKS_SUMMARY_CHARS = 4_000;

/**
 * Resolve the work item a fix round should claim as its subject.
 * Issue-driven runs keep the original issue; schedule/PR-native runs fall back
 * to the approval's pull-request work item.
 */
export function resolveFixRoundSubject(input: {
  originalSubjectWorkItemId?: string | null | undefined;
  approvalWorkItemId?: string | null | undefined;
}): string | null {
  const original = input.originalSubjectWorkItemId?.trim();
  if (original) return original;
  const approval = input.approvalWorkItemId?.trim();
  return approval || null;
}

export type FixRoundGateInput = {
  hasImplementingRun: boolean;
  hasImplementingAgent: boolean;
  attempts: number;
  maxRounds: number;
  resumeBranch: string | null;
  subjectWorkItemId: string | null;
};

/**
 * Returns an escalate reason when a fix round cannot start, or null when ok.
 */
export function fixRoundEscalateReason(input: FixRoundGateInput): string | null {
  if (!input.hasImplementingRun || !input.hasImplementingAgent) {
    return 'Implementing run or agent no longer exists';
  }
  if (input.attempts >= input.maxRounds) {
    return 'Automated fix-round cap reached';
  }
  if (!input.resumeBranch) {
    return 'Pull request branch is unavailable';
  }
  if (!input.subjectWorkItemId) {
    return 'Fix-round subject is unavailable';
  }
  return null;
}

const RETRYABLE_FIX_ROUND_STALL_ERRORS = [
  'Fix-round subject is unavailable',
  'Pull request branch is unavailable',
  // Pre–fix-round-unstick escalate text (legacy rows).
  'Pull request branch or original issue context is unavailable',
] as const;

/**
 * True when an approval was left awaiting-human after a fix-round gate failure
 * that the current platform can likely retry (resumeBranch still present).
 * Retries at most once per approval (`evidence.fixRoundStallRetried`).
 */
export function isRetryableFixRoundStall(input: {
  state: string;
  reviewVerdict: string | null;
  lastError: string | null;
  evidence: Record<string, unknown>;
}): boolean {
  if (input.state !== 'awaiting-human') return false;
  if (input.reviewVerdict !== 'changes-requested') return false;
  if (input.evidence['fixRoundStallRetried'] === true) return false;
  const resume =
    typeof input.evidence['resumeBranch'] === 'string'
      ? input.evidence['resumeBranch'].trim()
      : '';
  if (!resume) return false;
  const err = input.lastError?.trim() ?? '';
  return RETRYABLE_FIX_ROUND_STALL_ERRORS.some((message) => err === message);
}

/** Parse `integration.approval` from an agent row's integrationJson. */
export function agentConfiguredAutonomy(
  integrationJson: string,
): 'manual' | 'reviewer' | 'auto' | null {
  try {
    const parsed = JSON.parse(integrationJson) as { approval?: unknown };
    if (
      parsed.approval === 'manual' ||
      parsed.approval === 'reviewer' ||
      parsed.approval === 'auto'
    ) {
      return parsed.approval;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Resolve the approval that owns an open PR integration after runId may have
 * been reassigned to a fix run. Prefer run lookup, then PR URL → subject.
 */
export function resolveApprovalForIntegration(input: {
  integrationRunId: string;
  integrationPrUrl: string | null | undefined;
  findByRun: (runId: string) => Approval | null;
  findBySubject: (subjectType: string, subjectId: string) => Approval | null;
  findWorkItemByWebUrl: (webUrl: string) => { id: string } | null;
  findAttemptPrUrl?: (runId: string) => string | null;
}): Approval | null {
  const byRun = input.findByRun(input.integrationRunId);
  if (byRun) return byRun;

  const prUrl =
    input.integrationPrUrl?.trim() ||
    input.findAttemptPrUrl?.(input.integrationRunId)?.trim() ||
    null;
  if (!prUrl) return null;

  const workItem = input.findWorkItemByWebUrl(prUrl);
  if (!workItem) return null;
  return input.findBySubject('pull-request', workItem.id);
}

/**
 * Build actionable fix-round feedback from settled checks.
 * Prefer name + details + URL so the agent sees lint lines, not only "failed".
 */
export function formatChecksSummary(checks: NormalizedSourceCheck[]): string {
  if (checks.length === 0) {
    return '[]';
  }
  const parts = checks.map((check) => {
    const details = truncate(
      (check.details ?? '').trim() || check.status,
      MAX_CHECK_DETAILS_CHARS,
    );
    const url = check.webUrl?.trim();
    return url
      ? `${check.name}: ${details} (${url})`
      : `${check.name}: ${details}`;
  });
  return truncate(parts.join('\n'), MAX_CHECKS_SUMMARY_CHARS);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
