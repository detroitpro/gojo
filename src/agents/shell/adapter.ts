import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from '@/agents/adapter/types';
import { runProcess } from '@/process/supervisor';

const HANDOFF_RELATIVE_PATH = '.gojo/handoff.json';

function readHandoffIfPresent(workspacePath: string): unknown | undefined {
  const handoffPath = join(workspacePath, HANDOFF_RELATIVE_PATH);
  try {
    const raw = readFileSync(handoffPath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

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
    const scriptDir = join(ctx.workspacePath, '.gojo');
    mkdirSync(scriptDir, { recursive: true });
    const scriptPath = join(scriptDir, 'run.sh');
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
