/**
 * Pure run state-transition invariants. Wraps `@shared/run-states` canTransition/isTerminal
 * with intent-shaped guards used by application commands.
 *
 * No side effects: no DB, no clock, no ULID. Keep it pure so tests can drive it directly.
 */
import { canTransition, isTerminal, RunState } from "@shared/run-states";

export { RunState };

export type RunStateName = RunState;

/** Machine-readable reason a transition was rejected. */
export type TransitionRejection =
  | "already_terminal"
  | "invalid_transition"
  | "unknown_state";

export type TransitionResult =
  | { ok: true; from: RunStateName; to: RunStateName }
  | { ok: false; from: RunStateName; to: RunStateName; reason: TransitionRejection };

const KNOWN_STATES = new Set<string>(Object.values(RunState));

function isKnown(state: string): state is RunStateName {
  return KNOWN_STATES.has(state);
}

/** Guard a transition; returns a rich result rather than throwing so callers can compose. */
export function guardTransition(from: string, to: string): TransitionResult {
  if (!isKnown(from) || !isKnown(to)) {
    return {
      ok: false,
      from: (isKnown(from) ? from : RunState.Failed) as RunStateName,
      to: (isKnown(to) ? to : RunState.Failed) as RunStateName,
      reason: "unknown_state",
    };
  }
  if (from !== to && isTerminal(from)) {
    return { ok: false, from, to, reason: "already_terminal" };
  }
  if (!canTransition(from, to)) {
    return { ok: false, from, to, reason: "invalid_transition" };
  }
  return { ok: true, from, to };
}

/**
 * True when the caller is allowed to cancel a run currently in `state`.
 * Cancellation is always disallowed once the run is terminal.
 */
export function canCancel(state: string): boolean {
  return isKnown(state) && !isTerminal(state);
}

/** True when the caller may approve or reject a run awaiting review. */
export function canDecideApproval(state: string): boolean {
  return state === RunState.AwaitingApproval;
}

/** True when the caller may retry an existing run (creates a new queued run). */
export function canRetry(state: string): boolean {
  return isKnown(state) && isTerminal(state);
}

export { canTransition, isTerminal };
