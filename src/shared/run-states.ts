import { z } from 'zod';

/** Run lifecycle states per PRD §10.1. */
export const RunState = {
  Scheduled: 'Scheduled',
  Queued: 'Queued',
  Preparing: 'Preparing',
  Running: 'Running',
  Validating: 'Validating',
  AwaitingApproval: 'AwaitingApproval',
  Integrating: 'Integrating',
  Reporting: 'Reporting',
  Succeeded: 'Succeeded',
  Failed: 'Failed',
  Canceled: 'Canceled',
  TimedOut: 'TimedOut',
  Skipped: 'Skipped',
  Superseded: 'Superseded',
  Abandoned: 'Abandoned',
  Blocked: 'Blocked',
  Conflict: 'Conflict',
  InfrastructureFailure: 'InfrastructureFailure',
} as const;

export type RunState = (typeof RunState)[keyof typeof RunState];

const runStateValues = Object.values(RunState) as [RunState, ...RunState[]];

export const RunStateSchema = z.enum(runStateValues);

const TERMINAL_STATES: ReadonlySet<RunState> = new Set([
  RunState.Succeeded,
  RunState.Failed,
  RunState.Canceled,
  RunState.TimedOut,
  RunState.Skipped,
  RunState.Superseded,
  RunState.Abandoned,
  RunState.Blocked,
  RunState.Conflict,
  RunState.InfrastructureFailure,
]);

/** Valid transitions derived from PRD §10.1 state machine diagram. */
const VALID_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  [RunState.Scheduled]: [
    RunState.Queued,
    RunState.Skipped,
    RunState.Canceled,
    RunState.Superseded,
    RunState.Blocked,
  ],
  [RunState.Queued]: [
    RunState.Preparing,
    RunState.Skipped,
    RunState.Canceled,
    RunState.Superseded,
    RunState.Blocked,
    RunState.TimedOut,
  ],
  [RunState.Preparing]: [
    RunState.Running,
    RunState.Failed,
    RunState.Canceled,
    RunState.TimedOut,
    RunState.InfrastructureFailure,
    RunState.Abandoned,
  ],
  [RunState.Running]: [
    RunState.Validating,
    RunState.Preparing, // retry another attempt under the same run
    RunState.Failed,
    RunState.Canceled,
    RunState.TimedOut,
    RunState.InfrastructureFailure,
    RunState.Abandoned,
  ],
  [RunState.Validating]: [
    RunState.AwaitingApproval,
    RunState.Integrating,
    RunState.Reporting,
    RunState.Preparing, // retry another attempt under the same run
    RunState.Failed,
    RunState.Canceled,
    RunState.TimedOut,
    RunState.InfrastructureFailure,
    RunState.Abandoned,
  ],
  [RunState.AwaitingApproval]: [
    RunState.Integrating,
    RunState.Failed,
    RunState.Canceled,
    RunState.TimedOut,
    RunState.Abandoned,
  ],
  [RunState.Integrating]: [
    RunState.Reporting,
    RunState.Conflict,
    RunState.Failed,
    RunState.Canceled,
    RunState.TimedOut,
    RunState.InfrastructureFailure,
    RunState.Abandoned,
  ],
  [RunState.Reporting]: [
    RunState.Succeeded,
    RunState.Failed,
    RunState.InfrastructureFailure,
  ],
  [RunState.Succeeded]: [],
  [RunState.Failed]: [],
  [RunState.Canceled]: [],
  [RunState.TimedOut]: [],
  [RunState.Skipped]: [],
  [RunState.Superseded]: [],
  [RunState.Abandoned]: [],
  [RunState.Blocked]: [],
  [RunState.Conflict]: [],
  [RunState.InfrastructureFailure]: [],
};

/** Returns true when `state` is a terminal run state. */
export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Returns true when transitioning from `from` to `to` is allowed. */
export function canTransition(from: RunState, to: RunState): boolean {
  if (from === to) {
    return true;
  }

  if (isTerminal(from)) {
    return false;
  }

  return VALID_TRANSITIONS[from].includes(to);
}
