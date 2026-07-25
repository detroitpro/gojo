import type { AgentUsage } from '@/agents/usage';

export interface AgentAdapter {
  readonly name: string;
  detect(): Promise<{
    installed: boolean;
    version?: string;
    authenticated?: boolean;
  }>;
  execute(ctx: AgentExecuteContext): Promise<AgentExecuteResult>;
}

export type AgentLifecycleEvent =
  | { type: 'model'; model: string }
  | {
      type: 'tool';
      phase: 'started' | 'completed';
      callId: string;
      name: string;
      /** Short human summary (path, command, pattern, …) when available. */
      summary?: string;
    };

export interface AgentExecuteContext {
  workspacePath: string;
  prompt: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  onAgentEvent?: (event: AgentLifecycleEvent) => void;
}

export interface AgentExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  canceled: boolean;
  version?: string;
  handoff?: unknown;
  usage?: AgentUsage;
}
