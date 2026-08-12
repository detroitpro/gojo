import { describe, expect, test } from "bun:test";

import {
  approvalStatus,
  attentionStatus,
  deliveryStatus,
  enabledStatus,
  executionStatus,
  integrationStatus,
  provenanceStatus,
  runStateStatus,
  syncStateStatus,
  verificationStatus,
  workKindStatus,
  workResultStatus,
} from "../../../web/src/kernel/status-icons";

describe("web/status-icons", () => {
  test("maps every approval state", () => {
    for (const state of [
      "pending-review",
      "awaiting-human",
      "approved",
      "rejected",
      "held",
      "applying",
      "applied",
      "failed",
      "expired",
    ]) {
      expect(approvalStatus(state).label.length).toBeGreaterThan(0);
      expect(approvalStatus(state).tone).toBeTruthy();
    }
  });

  test("maps every known work kind", () => {
    for (const kind of [
      "run",
      "pull-request",
      "issue",
      "ticket",
      "incident",
      "deployment",
    ]) {
      const spec = workKindStatus(kind);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.tone).toBeTruthy();
    }
    expect(workKindStatus("unknown-kind").label).toBe("Unknown Kind");
  });

  test("maps execution, delivery, attention, and sync enums", () => {
    for (const execution of [
      "queued",
      "preparing",
      "running",
      "validating",
      "awaiting-approval",
      "integrating",
      "reporting",
      "terminal",
      "none",
    ]) {
      expect(executionStatus(execution).label.length).toBeGreaterThan(0);
    }
    for (const delivery of [
      "draft",
      "open",
      "review",
      "blocked",
      "merged",
      "closed",
      "none",
    ]) {
      expect(deliveryStatus(delivery).tone).toBeTruthy();
    }
    for (const attention of ["approval", "blocked", "stale", "sync-error", "none"]) {
      expect(attentionStatus(attention).tone).toBeTruthy();
    }
    for (const sync of [
      "pending",
      "syncing",
      "current",
      "stale",
      "error",
      "unsupported",
    ]) {
      expect(syncStateStatus(sync).label.length).toBeGreaterThan(0);
    }
  });

  test("maps run states, verification, integration, enabled, provenance", () => {
    expect(runStateStatus("Succeeded").tone).toBe("success");
    expect(runStateStatus("Failed").tone).toBe("failed");
    expect(runStateStatus("AwaitingApproval").tone).toBe("warn");
    expect(runStateStatus("Weird").tone).toBe("neutral");

    expect(verificationStatus("verified").tone).toBe("success");
    expect(verificationStatus("rejected").tone).toBe("failed");
    expect(integrationStatus("merged").tone).toBe("success");
    expect(integrationStatus("conflict").tone).toBe("failed");

    expect(enabledStatus(true).label).toBe("Enabled");
    expect(enabledStatus(false).label).toBe("Disabled");
    expect(provenanceStatus("gojo-agent").label).toBe("Gojo agent");
  });

  test("maps work results from delivery/outcome/resolution", () => {
    expect(
      workResultStatus({
        resolution: null,
        delivery: "merged",
        outcome: "succeeded",
      }).label,
    ).toBe("Merged");
    expect(
      workResultStatus({
        resolution: "operator",
        delivery: "open",
        outcome: "pending",
      }).label,
    ).toBe("Resolved by operator");
    expect(
      workResultStatus({
        resolution: null,
        delivery: "none",
        outcome: "failed",
      }).tone,
    ).toBe("failed");
  });
});
