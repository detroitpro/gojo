export interface AgentAdapter {
  readonly name: string;
  detect(): Promise<{
    installed: boolean;
    version?: string;
    authenticated?: boolean;
  }>;
  execute(ctx: AgentExecuteContext): Promise<AgentExecuteResult>;
}

export interface AgentExecuteContext {
  workspacePath: string;
  prompt: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface AgentExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  canceled: boolean;
  version?: string;
  handoff?: unknown;
}
