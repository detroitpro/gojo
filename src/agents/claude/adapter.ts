import type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from '@/agents/adapter/types';
import { runProcess } from '@/process/supervisor';

const CLI_COMMAND = 'claude';

async function whichClaude(): Promise<boolean> {
  const result = await runProcess({
    command: 'sh',
    args: ['-c', 'command -v claude'],
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  return result.exitCode === 0;
}

/**
 * Claude Code adapter.
 *
 * Assumes Claude Code CLI supports non-interactive `-p` prompts and JSON output via
 * `--output-format json`, matching documented headless usage patterns.
 */
export class ClaudeAgentAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  private version: string | undefined;

  async detect(): Promise<{
    installed: boolean;
    version?: string;
    authenticated?: boolean;
  }> {
    if (!(await whichClaude())) {
      return { installed: false };
    }

    const versionResult = await runProcess({
      command: CLI_COMMAND,
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    const version = (versionResult.stdout || versionResult.stderr)
      .split('\n')[0]
      ?.trim();
    this.version = version;

    return {
      installed: true,
      ...(version ? { version } : {}),
    };
  }

  private async ensureInstalled(): Promise<void> {
    const status = await this.detect();
    if (!status.installed) {
      throw new Error(
        'Claude Code CLI is not installed. Install `claude` and ensure it is on PATH.',
      );
    }
  }

  async execute(ctx: AgentExecuteContext): Promise<AgentExecuteResult> {
    await this.ensureInstalled();

    const result = await runProcess({
      command: CLI_COMMAND,
      args: ['-p', ctx.prompt, '--output-format', 'json'],
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

    let handoff: unknown;
    if (result.stdout.trim().length > 0) {
      try {
        handoff = JSON.parse(result.stdout) as unknown;
      } catch {
        // Leave handoff undefined when stdout is not JSON.
      }
    }

    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      canceled: result.canceled,
      ...(this.version ? { version: this.version } : {}),
      ...(handoff !== undefined ? { handoff } : {}),
    };
  }
}

export const claudeAgentAdapter = new ClaudeAgentAdapter();
