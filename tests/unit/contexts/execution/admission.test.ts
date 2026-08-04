import { describe, expect, test } from "bun:test";

import { selectAdmissions, type AdmissionCandidate, type AdmissionSnapshot } from "@/contexts/execution/application/admission";
import { DEFAULT_SCHEDULING_POLICY } from "@shared/scheduling";

function candidate(partial: Partial<AdmissionCandidate> & { id: string; projectId: string }): AdmissionCandidate {
  return {
    id: partial.id,
    projectId: partial.projectId,
    priority: partial.priority ?? 30,
    notBeforeAt: partial.notBeforeAt ?? "2026-07-26T00:00:00.000Z",
    expiresAt: partial.expiresAt ?? null,
    createdAt: partial.createdAt ?? "2026-07-26T00:00:00.000Z",
  };
}

const now = new Date("2026-07-26T12:00:00.000Z");
const noStagger = { ...DEFAULT_SCHEDULING_POLICY, minStartIntervalMs: 0 };

describe("selectAdmissions", () => {
  test("admits up to maxConcurrentRuns", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({ id: "a", projectId: "p1", priority: 10 }),
        candidate({ id: "b", projectId: "p2", priority: 10 }),
        candidate({ id: "c", projectId: "p3", priority: 10 }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, noStagger, now);
    expect(result.admit).toEqual(["a", "b"]);
    expect(result.expire).toEqual([]);
  });

  test("enforces per-project cap", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({ id: "a", projectId: "p1", priority: 10 }),
        candidate({ id: "b", projectId: "p1", priority: 10, createdAt: "2026-07-26T00:01:00.000Z" }),
        candidate({ id: "c", projectId: "p2", priority: 10 }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, noStagger, now);
    expect(result.admit).toEqual(["a", "c"]);
  });

  test("prefers lower priority numbers first", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({ id: "sched", projectId: "p1", priority: 30 }),
        candidate({ id: "manual", projectId: "p2", priority: 10 }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, { ...noStagger, maxConcurrentRuns: 1 }, now);
    expect(result.admit).toEqual(["manual"]);
  });

  test("round-robins across projects for fairness", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({ id: "p1a", projectId: "p1", priority: 30, createdAt: "2026-07-26T00:00:00.000Z" }),
        candidate({ id: "p1b", projectId: "p1", priority: 30, createdAt: "2026-07-26T00:00:01.000Z" }),
        candidate({ id: "p2a", projectId: "p2", priority: 30, createdAt: "2026-07-26T00:00:02.000Z" }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, noStagger, now);
    expect(result.admit).toEqual(["p1a", "p2a"]);
  });

  test("stagger admits at most one when minStartIntervalMs > 0", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({ id: "a", projectId: "p1", priority: 10 }),
        candidate({ id: "b", projectId: "p2", priority: 10 }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, DEFAULT_SCHEDULING_POLICY, now);
    expect(result.admit).toEqual(["a"]);
  });

  test("respects notBeforeAt", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({
          id: "future",
          projectId: "p1",
          notBeforeAt: "2026-07-26T13:00:00.000Z",
        }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, DEFAULT_SCHEDULING_POLICY, now);
    expect(result.admit).toEqual([]);
  });

  test("expires past expiresAt", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({
          id: "stale",
          projectId: "p1",
          expiresAt: "2026-07-26T11:00:00.000Z",
        }),
        candidate({ id: "fresh", projectId: "p2" }),
      ],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, noStagger, now);
    expect(result.expire).toEqual(["stale"]);
    expect(result.admit).toEqual(["fresh"]);
  });

  test("respects minStartIntervalMs", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [candidate({ id: "a", projectId: "p1", priority: 10 })],
      runningByProject: {},
      lastAdmittedAt: new Date("2026-07-26T11:59:50.000Z"),
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, DEFAULT_SCHEDULING_POLICY, now);
    expect(result.admit).toEqual([]);
  });

  test("load guard blocks when load is high", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [candidate({ id: "a", projectId: "p1", priority: 10 })],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 1.5,
    };
    const result = selectAdmissions(snapshot, DEFAULT_SCHEDULING_POLICY, now);
    expect(result.admit).toEqual([]);
  });

  test("load guard disabled when maxLoadPerCpu is 0", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [candidate({ id: "a", projectId: "p1", priority: 10 })],
      runningByProject: {},
      lastAdmittedAt: null,
      loadPerCpu: 9,
    };
    const result = selectAdmissions(snapshot, { ...noStagger, maxLoadPerCpu: 0 }, now);
    expect(result.admit).toEqual(["a"]);
  });

  test("accounts for already-running projects", () => {
    const snapshot: AdmissionSnapshot = {
      queued: [
        candidate({ id: "a", projectId: "p1", priority: 10 }),
        candidate({ id: "b", projectId: "p2", priority: 10 }),
      ],
      runningByProject: { p1: 1 },
      lastAdmittedAt: null,
      loadPerCpu: 0.1,
    };
    const result = selectAdmissions(snapshot, noStagger, now);
    expect(result.admit).toEqual(["b"]);
  });
});
