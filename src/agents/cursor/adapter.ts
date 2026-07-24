import type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from '@/agents/adapter/types';
import { readHandoffIfPresent } from '@/agents/handoff-file';
import {
  mapCursorStreamEvent,
  NdjsonLineBuffer,
  resolveAssistantTextDelta,
} from '@/agents/stream-json';
import { parseCursorUsage, type AgentUsage } from '@/agents/usage';
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
 * Uses stream-json so gojo can stream assistant text, capture tool calls,
 * and extract token usage from the terminal result event.
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
    const lineBuffer = new NdjsonLineBuffer();
    let model: string | undefined;
    let usage: AgentUsage | undefined;
    let resultText = '';
    let assistantEmitted = '';

    const handleLine = (line: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        ctx.onOutput?.('stdout', `${line}\n`);
        return;
      }

      for (const event of mapCursorStreamEvent(parsed)) {
        if (event.kind === 'model') {
          model = event.model;
          ctx.onAgentEvent?.({ type: 'model', model: event.model });
        } else if (event.kind === 'text') {
          const delta = resolveAssistantTextDelta(assistantEmitted, event.text);
          if (!delta || !delta.emit) {
            continue;
          }
          assistantEmitted = delta.nextPrevious;
          // Emit tokens as-is — do not force a newline per partial chunk.
          ctx.onOutput?.('stdout', delta.emit);
        } else if (event.kind === 'tool') {
          // New assistant segment after tools; avoid sticking markers mid-token.
          assistantEmitted = '';
          ctx.onAgentEvent?.({
            type: 'tool',
            phase: event.phase,
            callId: event.callId,
            name: event.name,
          });
          ctx.onOutput?.(
            'stdout',
            `\n[tool ${event.phase}] ${event.name} (${event.callId})\n`,
          );
        } else if (event.kind === 'result') {
          resultText =
            typeof event.payload['result'] === 'string'
              ? event.payload['result']
              : resultText;
          usage = parseCursorUsage(event.payload, model);
        }
      }
    };

    const result = await runProcess({
      command: cli.command,
      args: [
        '-p',
        '--trust',
        '-f',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        ctx.prompt,
      ],
      cwd: ctx.workspacePath,
      env: ctx.env,
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
      onStdout: (chunk: string) => {
        for (const line of lineBuffer.push(chunk)) {
          handleLine(line);
        }
      },
      onStderr: (chunk: string) => {
        ctx.onOutput?.('stderr', chunk);
      },
    });

    for (const line of lineBuffer.flush()) {
      handleLine(line);
    }

    // Fallback: if stream parsing missed usage, try whole stdout as JSON.
    if (!usage && result.stdout.trim().startsWith('{')) {
      try {
        const payload = JSON.parse(result.stdout) as Record<string, unknown>;
        usage = parseCursorUsage(payload, model);
        if (typeof payload['result'] === 'string') {
          resultText = payload['result'];
        }
      } catch {
        // keep prior values
      }
    }

    const handoff = readHandoffIfPresent(ctx.workspacePath);

    return {
      exitCode: result.exitCode ?? 1,
      stdout: resultText || result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      canceled: result.canceled,
      ...(cli.version ? { version: cli.version } : {}),
      ...(handoff !== undefined ? { handoff } : {}),
      ...(usage ? { usage } : {}),
    };
  }
}

export const cursorAgentAdapter = new CursorAgentAdapter();
