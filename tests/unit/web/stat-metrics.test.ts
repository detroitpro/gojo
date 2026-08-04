import { describe, expect, test } from "bun:test";

import {
  compareLabel,
  deltaTone,
  formatDelta,
  IMPACT_CATEGORIES,
  impactCategoryLabel,
  impactCategorySpec,
  METRICS,
  metricAriaLabel,
  metricDelta,
  metricTone,
} from "../../../web/src/kernel/stat-metrics";

describe("web/stat-metrics", () => {
  test("defines every catalog metric key", () => {
    const keys = [
      "work.working",
      "work.queued",
      "work.needsAttention",
      "work.staleOpen",
      "work.verifiedOpen",
      "runs.running",
      "runs.waiting",
      "impact.mergedRuns",
      "impact.commits",
      "impact.mergeRate",
      "impact.prsOpen",
      "impact.succeededRuns",
      ...IMPACT_CATEGORIES.map((c) => `impact.category.${c}`),
      "dashboard.projects",
      "dashboard.agents",
      "dashboard.schedules",
      "dashboard.runs",
      "queue.running",
      "queue.waiting",
      "queue.perProject",
      "queue.stagger",
      "settings.version",
      "settings.scheduler",
      "settings.telemetry",
    ];
    for (const key of keys) {
      const spec = METRICS[key];
      expect(spec).toBeTruthy();
      expect(spec!.key).toBe(key);
      expect(spec!.label.length).toBeGreaterThan(0);
      expect(spec!.icon).toBeTruthy();
    }
  });

  test("impactCategorySpec covers every HandoffImpactCategory and falls back for unknowns", () => {
    for (const category of IMPACT_CATEGORIES) {
      const spec = impactCategorySpec(category);
      expect(spec.key).toBe(`impact.category.${category}`);
      expect(spec.group).toBe("delivery");
      expect(spec.trend).toBe("none");
      expect(spec.label.length).toBeGreaterThan(0);
    }
    expect(impactCategoryLabel("dependency-update")).toBe("Dependency updates");
    expect(impactCategoryLabel("test-coverage")).toBe("Test updates");

    const unknown = impactCategorySpec("legacy-unknown");
    expect(unknown.label).toBe("legacy-unknown");
    expect(unknown.tone).toBe("neutral");
    expect(unknown.icon).toBeTruthy();
  });

  test("metricTone highlights attention metrics when value > 0", () => {
    const spec = METRICS["work.needsAttention"];
    expect(metricTone(spec, 0)).toBe("warn");
    expect(metricTone(spec, 2)).toBe("warn");
    expect(metricTone(METRICS["work.working"], 3)).toBe("running");
  });

  test("metricDelta and formatDelta", () => {
    expect(metricDelta(5, null)).toBeNull();
    expect(metricDelta(5, 2)).toBe(3);
    expect(formatDelta(3)).toBe("+3");
    expect(formatDelta(-2)).toBe("-2");
    expect(formatDelta(0)).toBe("0");
    expect(formatDelta(null)).toBe("");
  });

  test("deltaTone respects direction", () => {
    const upGood = METRICS["impact.mergedRuns"];
    expect(deltaTone(upGood, 2)).toBe("success");
    expect(deltaTone(upGood, -1)).toBe("failed");
    const upBad = METRICS["work.needsAttention"];
    expect(deltaTone(upBad, 1)).toBe("warn");
    expect(deltaTone(upBad, -1)).toBe("success");
    expect(deltaTone(upGood, 0)).toBe("neutral");
  });

  test("compareLabel for asOf and previousWindow trends", () => {
    expect(compareLabel("none", "24h")).toBe("");
    expect(compareLabel("asOf", "24h")).toBe("vs 24 hours ago");
    expect(compareLabel("asOf", "7d")).toBe("vs 7 days ago");
    expect(compareLabel("previousWindow", "30d")).toBe("vs previous 30 days");
    expect(compareLabel("previousWindow", "90d")).toBe("vs previous 90 days");
    expect(compareLabel("previousWindow", "all")).toBe("");
  });

  test("metricAriaLabel composes value and delta", () => {
    const spec = METRICS["dashboard.runs"];
    expect(metricAriaLabel(spec, "12", 2, "vs 24 hours ago")).toBe(
      "Runs: 12 (+2 vs 24 hours ago)",
    );
  });
});
