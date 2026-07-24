import { describe, expect, test } from 'bun:test';

import { canTransition, isTerminal, RunState } from '../../../src/shared/run-states';

describe('RunState', () => {
  test('happy-path transitions follow PRD §10.1 diagram', () => {
    expect(canTransition(RunState.Scheduled, RunState.Queued)).toBe(true);
    expect(canTransition(RunState.Queued, RunState.Preparing)).toBe(true);
    expect(canTransition(RunState.Preparing, RunState.Running)).toBe(true);
    expect(canTransition(RunState.Running, RunState.Validating)).toBe(true);
    expect(canTransition(RunState.Running, RunState.Preparing)).toBe(true);
    expect(canTransition(RunState.Validating, RunState.Preparing)).toBe(true);
    expect(canTransition(RunState.Validating, RunState.AwaitingApproval)).toBe(true);
    expect(canTransition(RunState.Validating, RunState.Integrating)).toBe(true);
    expect(canTransition(RunState.Validating, RunState.Reporting)).toBe(true);
    expect(canTransition(RunState.AwaitingApproval, RunState.Integrating)).toBe(true);
    expect(canTransition(RunState.Integrating, RunState.Reporting)).toBe(true);
    expect(canTransition(RunState.Reporting, RunState.Succeeded)).toBe(true);
  });

  test('validation and reporting can fail', () => {
    expect(canTransition(RunState.Validating, RunState.Failed)).toBe(true);
    expect(canTransition(RunState.Reporting, RunState.Failed)).toBe(true);
  });

  test('integrating can end in conflict', () => {
    expect(canTransition(RunState.Integrating, RunState.Conflict)).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(canTransition(RunState.Scheduled, RunState.Running)).toBe(false);
    expect(canTransition(RunState.Running, RunState.Succeeded)).toBe(false);
    expect(canTransition(RunState.Validating, RunState.Succeeded)).toBe(false);
    expect(canTransition(RunState.Succeeded, RunState.Queued)).toBe(false);
  });

  test('allows self-transition for idempotent updates', () => {
    expect(canTransition(RunState.Running, RunState.Running)).toBe(true);
    expect(canTransition(RunState.Succeeded, RunState.Succeeded)).toBe(true);
  });

  test('terminal states cannot transition to other states', () => {
    for (const state of Object.values(RunState)) {
      if (!isTerminal(state)) {
        continue;
      }

      for (const target of Object.values(RunState)) {
        if (target === state) {
          expect(canTransition(state, target)).toBe(true);
        } else {
          expect(canTransition(state, target)).toBe(false);
        }
      }
    }
  });

  test('identifies terminal states from PRD §10.1', () => {
    const terminal = [
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
    ];

    for (const state of terminal) {
      expect(isTerminal(state)).toBe(true);
    }
  });

  test('identifies non-terminal active states', () => {
    const active = [
      RunState.Scheduled,
      RunState.Queued,
      RunState.Preparing,
      RunState.Running,
      RunState.Validating,
      RunState.AwaitingApproval,
      RunState.Integrating,
      RunState.Reporting,
    ];

    for (const state of active) {
      expect(isTerminal(state)).toBe(false);
    }
  });

  test('scheduled and queued runs can be skipped or blocked', () => {
    expect(canTransition(RunState.Scheduled, RunState.Skipped)).toBe(true);
    expect(canTransition(RunState.Scheduled, RunState.Blocked)).toBe(true);
    expect(canTransition(RunState.Queued, RunState.Skipped)).toBe(true);
    expect(canTransition(RunState.Queued, RunState.Blocked)).toBe(true);
  });

  test('active runs can be canceled or abandoned', () => {
    expect(canTransition(RunState.Running, RunState.Canceled)).toBe(true);
    expect(canTransition(RunState.Running, RunState.Abandoned)).toBe(true);
    expect(canTransition(RunState.Preparing, RunState.TimedOut)).toBe(true);
    expect(canTransition(RunState.Running, RunState.InfrastructureFailure)).toBe(true);
  });
});
