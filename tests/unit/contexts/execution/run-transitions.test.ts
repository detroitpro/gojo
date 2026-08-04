import { describe, expect, test } from "bun:test";

import {
  canCancel,
  canDecideApproval,
  canRetry,
  guardTransition,
  RunState,
} from "@/contexts/execution/domain/run-transitions";

describe("contexts/execution/domain/run-transitions", () => {
  test("guardTransition accepts known valid transition", () => {
    const result = guardTransition(RunState.Preparing, RunState.Running);
    expect(result.ok).toBe(true);
  });

  test("guardTransition rejects unknown state", () => {
    const result = guardTransition("Bogus", RunState.Running);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_state");
  });

  test("guardTransition rejects transitions out of terminal states", () => {
    const result = guardTransition(RunState.Succeeded, RunState.Running);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already_terminal");
  });

  test("guardTransition rejects invalid transitions", () => {
    const result = guardTransition(RunState.Queued, RunState.Reporting);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_transition");
  });

  test("canCancel is true for non-terminal states", () => {
    expect(canCancel(RunState.Queued)).toBe(true);
    expect(canCancel(RunState.Running)).toBe(true);
    expect(canCancel(RunState.Succeeded)).toBe(false);
    expect(canCancel(RunState.Failed)).toBe(false);
    expect(canCancel("Nonsense")).toBe(false);
  });

  test("canDecideApproval only allowed while awaiting", () => {
    expect(canDecideApproval(RunState.AwaitingApproval)).toBe(true);
    expect(canDecideApproval(RunState.Running)).toBe(false);
    expect(canDecideApproval(RunState.Succeeded)).toBe(false);
  });

  test("canRetry only allowed on terminal states", () => {
    expect(canRetry(RunState.Failed)).toBe(true);
    expect(canRetry(RunState.Succeeded)).toBe(true);
    expect(canRetry(RunState.Running)).toBe(false);
  });
});
