/**
 * Zod-free terminal-state helpers — safe for the Vite admin bundle.
 * Keep the list in sync with RunState terminal values in run-states.ts.
 */

/** Terminal run states (PRD §10.1). */
export const TERMINAL_RUN_STATES = [
  "Succeeded",
  "Failed",
  "Canceled",
  "TimedOut",
  "Skipped",
  "Superseded",
  "Abandoned",
  "Blocked",
  "Conflict",
  "InfrastructureFailure",
] as const;

export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RUN_STATES);

export function isTerminalRunState(state: string): boolean {
  return TERMINAL_SET.has(state);
}
