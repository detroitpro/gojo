export type {
  Attempt,
  RunArtifactsResult,
  RunDiffResult,
  RunEvent,
  RunImpactItem,
  RunIntegration,
  RunState,
  RunTrigger,
  Run as ContractRun,
} from "@gojo/contracts/types";

import type { Attempt, Run as ContractRun, RunImpactItem, RunIntegration } from "@gojo/contracts/types";

import type { Approval } from "@/contexts/delivery/contract";

/** Run with optional list/detail enrichments. */
export type Run = ContractRun & {
  projectName?: string | null;
  agentName?: string | null;
};

export interface ValidationStepEventData {
  name: string;
  command: string;
  exitCode: number | null;
  status: "passed" | "failed" | "timed_out" | "canceled" | string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AgentOutputEventData {
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface AgentUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCostUsd: number | null;
  costSource: string;
  model?: string;
}

export interface AgentFinishedEventData {
  exitCode: number;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  usage?: AgentUsageSummary | null;
}

export type RunDetail = {
  run: Run;
  attempts: Attempt[];
  impactItems: RunImpactItem[];
  integration: RunIntegration | null;
  approval: Approval | null;
};
