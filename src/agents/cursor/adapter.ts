import type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from '@/agents/adapter/types';
import { runProcess } from '@/process/supervisor';

const CLI_CANDIDATES = ['agent', 'cursor-agent'] as const;

type CliCandidate = (typeof CLI_CANDIDATES)[number];

interface DetectedCli {
  command: CliCandidate;
  version?: string;
}

async function which(command: string): Promise<boolean> {
  const result = await runProcess({
    command: 'sh',
    args: ['-c', `command -v ${command}`],
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  return result.exitCode === 0;
}

async function detectCli(): Promise<DetectedCli | null> {
  for (const command of CLI_CANDIDATES) {
    if (!(await which(command))) {
      continue;
    }

    const versionResult = await runProcess({
      command,
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    const versionLine = (versionResult.stdout || versionResult.stderr)
      .split('\n')[0]
      ?.trim();

    return {
      command,
      ...(versionLine ? { version: versionLine } : {}),
    };
  }

  return null;
}

/**
 * Cursor agent adapter.
 *
 * Assumes a non-interactive CLI supporting `-p` / `--print` style prompt flags,
 * matching common Cursor Agent CLI usage: `agent -p "<prompt>"`.
 */
export class CursorAgentAdapter implements AgentAdapter {
  readonly name = 'cursor';
  private detected: DetectedCli | null | undefined;

  async detect(): Promise<{
    installed: boolean;
    version?: string;
    authenticated?: boolean;
  }> {
    const cli = await detectCli();
    this.detected = cli;

    if (!cli) {
      return { installed: false };
    }

    return {
      installed: true,
      ...(cli.version ? { version: cli.version } : {}),
    };
  }

  private async requireCli(): Promise<DetectedCli> {
    if (this.detected === undefined) {
      await this.detect();
    }

    if (!this.detected) {
      throw new Error(
        'Cursor agent CLI is not installed. Install `agent` or `cursor-agent` and ensure it is on PATH.',
      );
    }

    return this.detected;
  }

  async execute(ctx: AgentExecuteContext): Promise<AgentExecuteResult> {
    const cli = await this.requireCli();

    // Non-interactive prompt mode; cwd scopes edits to the prepared worktree.
    const result = await runProcess({
      command: cli.command,
      args: ['-p', ctx.prompt],
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

    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      canceled: result.canceled,
      ...(cli.version ? { version: cli.version } : {}),
    };
  }
}

export const cursorAgentAdapter = new CursorAgentAdapter();
