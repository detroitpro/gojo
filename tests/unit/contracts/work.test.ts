import { describe, expect, test } from "bun:test";

import {
  parseWorkAttention,
  parseWorkDelivery,
  parseWorkExecution,
  parseWorkOutcome,
  parseWorkProvenance,
} from "@shared/work";

describe("parseWorkProvenance", () => {
  test("accepts known values", () => {
    expect(parseWorkProvenance("gojo-agent")).toBe("gojo-agent");
    expect(parseWorkProvenance("human")).toBe("human");
  });

  test("rejects unknown and empty values", () => {
    expect(parseWorkProvenance("unknown")).toBeNull();
    expect(parseWorkProvenance("")).toBeNull();
    expect(parseWorkProvenance(null)).toBeNull();
  });
});

describe("parseWorkDelivery", () => {
  test("accepts known values", () => {
    expect(parseWorkDelivery("open")).toBe("open");
    expect(parseWorkDelivery("merged")).toBe("merged");
  });

  test("rejects unknown values", () => {
    expect(parseWorkDelivery("shipped")).toBeNull();
  });
});

describe("parseWorkAttention", () => {
  test("accepts known values", () => {
    expect(parseWorkAttention("approval")).toBe("approval");
    expect(parseWorkAttention("sync-error")).toBe("sync-error");
  });

  test("rejects unknown values", () => {
    expect(parseWorkAttention("urgent")).toBeNull();
  });
});

describe("parseWorkExecution", () => {
  test("accepts known values", () => {
    expect(parseWorkExecution("running")).toBe("running");
    expect(parseWorkExecution("awaiting-approval")).toBe("awaiting-approval");
  });

  test("rejects unsafe casts", () => {
    expect(parseWorkExecution("RUNNING")).toBeNull();
    expect(parseWorkExecution("done")).toBeNull();
  });
});

describe("parseWorkOutcome", () => {
  test("accepts known values", () => {
    expect(parseWorkOutcome("succeeded")).toBe("succeeded");
    expect(parseWorkOutcome("no-change")).toBe("no-change");
  });

  test("rejects unknown values", () => {
    expect(parseWorkOutcome("success")).toBeNull();
  });
});
