import { afterEach, describe, expect, test } from "bun:test";

import {
  __testing__getCounterValue,
  __testing__getSpanRecords,
  __testing__resetTelemetry,
  configureTelemetry,
  getMeter,
  startSpan,
} from "@/telemetry/otel";

describe("telemetry/otel", () => {
  afterEach(() => {
    __testing__resetTelemetry();
  });

  test("configureTelemetry gates emission", () => {
    configureTelemetry({ enabled: false, serviceName: "gojo-test" });
    const span = startSpan("test-span");
    span.end();
    expect(__testing__getSpanRecords()).toHaveLength(1);
  });

  test("startSpan records attributes and exceptions", () => {
    configureTelemetry({ enabled: true, serviceName: "gojo-test" });
    const span = startSpan("work", { scheduleId: "abc" });
    span.setAttribute("attempt", 1);
    span.recordException(new Error("boom"));
    span.end();

    const [record] = __testing__getSpanRecords();
    expect(record?.name).toBe("work");
    expect(record?.attributes).toEqual({ scheduleId: "abc", attempt: 1 });
    expect(record?.exceptions).toEqual(["boom"]);
    expect(record?.traceId).toHaveLength(32);
    expect(record?.spanId).toHaveLength(16);
  });

  test("getMeter counter accumulates values", () => {
    configureTelemetry({ enabled: true, serviceName: "gojo-test" });
    const meter = getMeter();
    meter.counter("scheduler.tick").add(1, { node: "a" });
    meter.counter("scheduler.tick").add(2, { node: "a" });

    expect(__testing__getCounterValue("scheduler.tick")).toBe(3);
  });
});
