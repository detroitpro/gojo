import { isTerminalRunState } from "@gojo/contracts/types";

import type { RunEvent } from "@gojo/contracts/types";

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
 *
 * `run.finished` / `run.failed` close the last open segment — terminalRun
 * historically emitted finished without a state_changed to Succeeded/Failed.
 */
export function buildPhaseSegments(events: RunEvent[], nowMs = Date.now()): PhaseSegment[] {
  const transitions: Array<{ at: string; to: string }> = [];
  let closeAt: string | null = null;

  for (const event of events) {
    if (event.type === "run.state_changed" && event.data && typeof event.data === "object") {
      const data = event.data as { to?: string };
      if (typeof data.to === "string" && event.at) {
        transitions.push({ at: event.at, to: data.to });
        if (isTerminalRunState(data.to)) {
          closeAt = event.at;
        }
      }
      continue;
    }

    if (
      (event.type === "run.finished" || event.type === "run.failed") &&
      event.at
    ) {
      // Prefer the earliest close signal; finished usually arrives once.
      if (!closeAt || Date.parse(event.at) < Date.parse(closeAt)) {
        closeAt = event.at;
      }
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

  const lastTransition = transitions[transitions.length - 1]!;
  const terminalByTransition = isTerminalRunState(lastTransition.to);
  const terminal = terminalByTransition || closeAt != null;

  // Close a still-open lane (e.g. Reporting) when the run finished without
  // a state_changed into a terminal state.
  if (closeAt) {
    const open = raw[raw.length - 1];
    if (open && open.finishedAt === null) {
      open.finishedAt = closeAt;
    }
  }

  return raw.map((segment) => {
    const endMs = segment.finishedAt
      ? Date.parse(segment.finishedAt)
      : terminal
        ? Date.parse(closeAt ?? lastTransition.at)
        : nowMs;
    const startMs = Date.parse(segment.startedAt);
    const durationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
    const active = segment.finishedAt === null && !terminal;
    return {
      key: segment.key,
      label: PHASE_LABELS[segment.key],
      startedAt: segment.startedAt,
      finishedAt: active ? null : (segment.finishedAt ?? closeAt ?? lastTransition.at),
      durationMs,
      active,
    };
  });
}
