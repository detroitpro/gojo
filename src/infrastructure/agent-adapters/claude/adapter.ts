import type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from '@/infrastructure/agent-adapters/adapter/types';
import { readHandoffIfPresent } from '@/infrastructure/agent-adapters/handoff-file';
import { parseClaudeUsage } from '@/infrastructure/agent-adapters/usage';
import { runProcess } from '@/infrastructure/process/supervisor';

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
 * Uses `--output-format json` for usage/cost, and reads `.gojo/handoff.json`
 * for the platform handoff report (not the CLI envelope).
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

    let usage = undefined;
    let resultText = result.stdout;
    if (result.stdout.trim().length > 0) {
      try {
        const payload = JSON.parse(result.stdout) as Record<string, unknown>;
        usage = parseClaudeUsage(payload);
        if (typeof payload['result'] === 'string') {
          resultText = payload['result'];
        } else if (typeof payload['content'] === 'string') {
          resultText = payload['content'];
        }
        if (typeof payload['model'] === 'string') {
          ctx.onAgentEvent?.({ type: 'model', model: payload['model'] });
        }
      } catch {
        // Leave usage undefined when stdout is not JSON.
      }
    }

    const handoff = readHandoffIfPresent(ctx.workspacePath);

    return {
      exitCode: result.exitCode ?? 1,
      stdout: resultText,
      stderr: result.stderr,
      timedOut: result.timedOut,
      canceled: result.canceled,
      ...(this.version ? { version: this.version } : {}),
      ...(handoff !== undefined ? { handoff } : {}),
      ...(usage ? { usage } : {}),
    };
  }
}

export const claudeAgentAdapter = new ClaudeAgentAdapter();
