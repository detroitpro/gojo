import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { InstructionsConfig } from '@shared/manifest';

export type ValidationPromptStep = {
  name: string;
  command: string;
  timeout?: string;
};

export type AssembleAgentPromptInput = {
  taskPrompt: string;
  adapterName: string;
  workspacePath: string;
  instructions?: InstructionsConfig;
  validationSteps: ValidationPromptStep[];
  progressReporting?: boolean;
};

/** Resolve a repo-relative instruction path; reject escapes outside the worktree. */
export function resolveInstructionFilePath(
  workspacePath: string,
  relativePath: string,
): string {
  const trimmed = relativePath.trim();
  if (!trimmed || isAbsolute(trimmed)) {
    throw new Error(`Invalid instruction file path: ${relativePath}`);
  }
  const root = resolve(workspacePath);
  const resolved = resolve(root, trimmed);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`Instruction file escapes workspace: ${relativePath}`);
  }
  return resolved;
}

function readInstructionFile(workspacePath: string, relativePath: string): string {
  const absolute = resolveInstructionFilePath(workspacePath, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`Instruction file not found: ${relativePath}`);
  }
  return readFileSync(absolute, 'utf8');
}

function prependInstructions(
  taskPrompt: string,
  workspacePath: string,
  instructions: InstructionsConfig | undefined,
): string {
  if (!instructions) {
    return taskPrompt;
  }

  const parts: string[] = [];
  const notice = instructions.scheduledRunNotice?.trim();
  if (notice) {
    parts.push(notice);
  }

  for (const file of instructions.files ?? []) {
    const body = readInstructionFile(workspacePath, file).trimEnd();
    if (body.length > 0) {
      parts.push(body);
    }
  }

  if (parts.length === 0) {
    return taskPrompt;
  }

  return `${parts.join('\n\n')}\n\n${taskPrompt.trimStart()}`;
}

/** Append exact gojo validation commands so agents can self-check against the gate. */
export function appendValidationPrompt(
  prompt: string,
  steps: ValidationPromptStep[],
): string {
  if (steps.length === 0) {
    return prompt;
  }

  const lines = [
    '',
    '## Gojo validation (exact commands)',
    '',
    'After you finish, gojo will run these validation steps from the worktree root.',
    'Your changes must pass them. Run them yourself before exiting when practical.',
    '',
  ];

  for (const [index, step] of steps.entries()) {
    const timeout = step.timeout ? ` (timeout ${step.timeout})` : '';
    lines.push(`${index + 1}. **${step.name}**${timeout}`);
    lines.push('```');
    lines.push(step.command);
    lines.push('```');
    lines.push('');
  }

  return `${prompt.trimEnd()}\n${lines.join('\n')}`;
}

/** Shell adapter executes the prompt as a script — keep validation as comments. */
export function appendValidationPromptAsShellComments(
  prompt: string,
  steps: ValidationPromptStep[],
): string {
  if (steps.length === 0) {
    return prompt;
  }

  const lines = [
    '',
    '# Gojo validation (exact commands)',
    '# After this script exits, gojo will run these from the worktree root.',
  ];

  for (const [index, step] of steps.entries()) {
    const timeout = step.timeout ? ` (timeout ${step.timeout})` : '';
    lines.push(`# ${index + 1}. ${step.name}${timeout}`);
    lines.push(`# ${step.command}`);
  }

  return `${prompt.trimEnd()}\n${lines.join('\n')}\n`;
}

/**
 * Build the final adapter prompt.
 * AI adapters get scheduled notice + instruction files + task prompt + validation.
 * Shell adapters skip instructions (script body stays executable).
 */
export function assembleAgentPrompt(input: AssembleAgentPromptInput): string {
  if (input.adapterName === 'shell') {
    return appendValidationPromptAsShellComments(
      input.taskPrompt,
      input.validationSteps,
    );
  }

  const withInstructions = prependInstructions(
    input.taskPrompt,
    input.workspacePath,
    input.instructions,
  );
  const withValidation = appendValidationPrompt(withInstructions, input.validationSteps);
  if (!input.progressReporting) {
    return withValidation;
  }
  return `${withValidation.trimEnd()}

## Gojo progress reporting

Report your current focus when work starts or changes, and report blockers promptly.
POST JSON with \`title\`, \`summary\`, optional \`blockedReason\`, and optional
\`references\` to \`$GOJO_API_URL/runs/$GOJO_RUN_ID/progress\` using
\`Authorization: Bearer $GOJO_API_TOKEN\`. The token is scoped to this run only.
`;
}
