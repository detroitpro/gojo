/**
 * Build GitHub PR title/body from an agent handoff when gojo owns `gh pr create`.
 */

import {
  findHandoffAssetByRole,
  readHandoffAssets,
} from '@/agents/handoff-assets';

export interface PrDescriptionInput {
  taskName: string;
  runId: string;
  /** Used when handoff summary is missing or empty. */
  fallbackTitle: string;
  handoff?: unknown;
  /** Worktree root for resolving path-based handoff assets. */
  workspacePath?: string;
}

export interface PrDescription {
  title: string;
  body: string;
}

interface HandoffFields {
  summary?: string;
  decisions?: string[];
  filesChanged?: string[];
  unresolvedIssues?: string[];
  recommendedNextActions?: string[];
  status?: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readHandoffFields(handoff: unknown): HandoffFields {
  if (!handoff || typeof handoff !== 'object') {
    return {};
  }
  const obj = handoff as Record<string, unknown>;
  return {
    ...(typeof obj['summary'] === 'string' ? { summary: obj['summary'] } : {}),
    decisions: asStringArray(obj['decisions']),
    filesChanged: asStringArray(obj['filesChanged']),
    unresolvedIssues: asStringArray(obj['unresolvedIssues']),
    recommendedNextActions: asStringArray(obj['recommendedNextActions']),
    ...(typeof obj['status'] === 'string' ? { status: obj['status'] } : {}),
  };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? '';
}

function truncateTitle(text: string, max = 72): string {
  if (text.length <= max) {
    return text;
  }
  const sliced = text.slice(0, max - 1).trimEnd();
  return `${sliced}…`;
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function gojoFooter(input: PrDescriptionInput, status?: string): string {
  const lines = [
    '---',
    '',
    `Opened by **gojo** for task \`${input.taskName}\` (run \`${input.runId}\`).`,
  ];
  if (status) {
    lines.push(`Handoff status: \`${status}\`.`);
  }
  return lines.join('\n');
}

/**
 * Derive a reviewable PR title and markdown body from handoff fields.
 * Prefers `pr-title` / `pr-body` assets when present.
 */
export function buildPrDescription(input: PrDescriptionInput): PrDescription {
  const fields = readHandoffFields(input.handoff);
  const assets = readHandoffAssets(input.handoff);
  const workspacePath = input.workspacePath;

  const titleAsset = findHandoffAssetByRole(workspacePath, assets, 'pr-title');
  const bodyAsset = findHandoffAssetByRole(workspacePath, assets, 'pr-body');

  const summary = fields.summary?.trim() ?? '';
  const summaryTitle = summary ? firstLine(summary) : '';
  const titleFromAsset = titleAsset ? firstLine(titleAsset.content) : '';
  const title = titleFromAsset
    ? truncateTitle(titleFromAsset)
    : summaryTitle
      ? truncateTitle(summaryTitle)
      : input.fallbackTitle;

  if (bodyAsset?.content.trim()) {
    const body = [bodyAsset.content.trim(), '', gojoFooter(input, fields.status)].join('\n');
    return { title, body };
  }

  const sections: string[] = [];

  sections.push('## Summary');
  sections.push(
    summary.length > 0
      ? summary
      : `Automated gojo task \`${input.taskName}\` completed.`,
  );

  if (fields.decisions && fields.decisions.length > 0) {
    sections.push('', '## Decisions');
    sections.push(bulletList(fields.decisions));
  }

  if (fields.filesChanged && fields.filesChanged.length > 0) {
    sections.push('', '## Files changed');
    sections.push(bulletList(fields.filesChanged));
  }

  if (fields.unresolvedIssues && fields.unresolvedIssues.length > 0) {
    sections.push('', '## Unresolved issues');
    sections.push(bulletList(fields.unresolvedIssues));
  }

  if (fields.recommendedNextActions && fields.recommendedNextActions.length > 0) {
    sections.push('', '## Recommended next actions');
    sections.push(bulletList(fields.recommendedNextActions));
  }

  sections.push('', gojoFooter(input, fields.status));

  return {
    title,
    body: sections.join('\n'),
  };
}
