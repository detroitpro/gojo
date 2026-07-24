import type { RunEvent } from "@/types";

export type PhaseKey = "prepare" | "agent" | "validate" | "integrate";

export interface PhaseSegment {
  key: PhaseKey;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  active: boolean;
}

const PHASE_LABELS: Record<PhaseKey, string> = {
  prepare: "Prepare",
  agent: "Agent",
  validate: "Validate",
  integrate: "Integrate",
};

function phaseForState(state: string): PhaseKey | null {
  switch (state) {
    case "Preparing":
      return "prepare";
    case "Running":
      return "agent";
    case "Validating":
      return "validate";
    case "Integrating":
    case "AwaitingApproval":
    case "Reporting":
      return "integrate";
    default:
      return null;
  }
}

/**
 * Build wall-clock phase segments from run.state_changed events.
 * Adjacent visits to the same phase are merged.
 */
export function buildPhaseSegments(events: RunEvent[], nowMs = Date.now()): PhaseSegment[] {
  const transitions: Array<{ at: string; to: string }> = [];

  for (const event of events) {
    if (event.type !== "run.state_changed" || !event.data || typeof event.data !== "object") {
      continue;
    }
    const data = event.data as { to?: string };
    if (typeof data.to === "string" && event.at) {
      transitions.push({ at: event.at, to: data.to });
    }
  }

  if (transitions.length === 0) {
    return [];
  }

  const raw: Array<{ key: PhaseKey; startedAt: string; finishedAt: string | null }> = [];

  for (let i = 0; i < transitions.length; i += 1) {
    const current = transitions[i]!;
    const key = phaseForState(current.to);
    if (!key) {
      continue;
    }
    const next = transitions[i + 1];
    const finishedAt = next?.at ?? null;
    const last = raw[raw.length - 1];
    if (last && last.key === key && last.finishedAt === null) {
      last.finishedAt = finishedAt;
      continue;
    }
    if (last && last.key === key && last.finishedAt === current.at) {
      last.finishedAt = finishedAt;
      continue;
    }
    raw.push({ key, startedAt: current.at, finishedAt });
  }

  // Close open segment at "now" only if still active (no terminal after last open).
  const lastTransition = transitions[transitions.length - 1]!;
  const terminal =
    lastTransition.to === "Succeeded" ||
    lastTransition.to === "Failed" ||
    lastTransition.to === "Canceled" ||
    lastTransition.to === "TimedOut" ||
    lastTransition.to === "Abandoned" ||
    lastTransition.to === "Conflict" ||
    lastTransition.to === "InfrastructureFailure";

  return raw.map((segment) => {
    const endMs = segment.finishedAt
      ? Date.parse(segment.finishedAt)
      : terminal
        ? Date.parse(lastTransition.at)
        : nowMs;
    const startMs = Date.parse(segment.startedAt);
    const durationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
    return {
      key: segment.key,
      label: PHASE_LABELS[segment.key],
      startedAt: segment.startedAt,
      finishedAt: segment.finishedAt,
      durationMs,
      active: segment.finishedAt === null && !terminal,
    };
  });
}
