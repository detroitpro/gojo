import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from '@/infrastructure/agent-adapters/adapter/types';
import { readHandoffIfPresent } from '@/infrastructure/agent-adapters/handoff-file';
import { runProcess } from '@/infrastructure/process/supervisor';
import { RUN_SCRIPT_RELATIVE_PATH } from '@shared/workspace-files';

export class ShellAgentAdapter implements AgentAdapter {
  readonly name = 'shell';

  async detect(): Promise<{
    installed: boolean;
    version?: string;
  }> {
    const result = await runProcess({
      command: 'sh',
      args: ['-c', 'command -v sh >/dev/null 2>&1'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    if (result.exitCode !== 0) {
      return { installed: false };
    }

    return {
      installed: true,
      version: 'sh',
    };
  }

  async execute(ctx: AgentExecuteContext): Promise<AgentExecuteResult> {
    const scriptPath = join(ctx.workspacePath, RUN_SCRIPT_RELATIVE_PATH);
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, ctx.prompt, 'utf8');

    const result = await runProcess({
      command: 'sh',
      args: [scriptPath],
      cwd: ctx.workspacePath,
      env: ctx.env,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      ...(ctx.onOutput
        ? {
            onStdout: (chunk: string) => {
              ctx.onOutput?.('stdout', chunk);
            },
            onStderr: (chunk: string) => {
              ctx.onOutput?.('stderr', chunk);
            },
          }
        : {}),
    });

    const handoff = readHandoffIfPresent(ctx.workspacePath);

    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      canceled: result.canceled,
      ...(handoff !== undefined ? { handoff } : {}),
    };
  }
}

export const shellAgentAdapter = new ShellAgentAdapter();
