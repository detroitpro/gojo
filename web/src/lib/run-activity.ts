import type { PhaseKey } from "@/lib/run-phases";
import type { RunEvent, ValidationStepEventData } from "@/types";

export type ActivityKind =
  | "lifecycle"
  | "agent"
  | "assistant"
  | "tool"
  | "validation"
  | "artifact"
  | "error";

export interface ActivityItem {
  id: string;
  at: string;
  atMs: number;
  phase: PhaseKey | null;
  kind: ActivityKind;
  title: string;
  detail?: string;
  body?: string;
  status?: "info" | "success" | "error" | "warn";
  validation?: ValidationStepEventData;
}

const TOOL_LINE_RE = /^\[tool (?:started|completed)\]\s+/;

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

function parseMs(at: string): number {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
}

function stripToolDuplicateLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !TOOL_LINE_RE.test(line.trim()))
    .join("\n");
}

function assistantTitle(text: string): string {
  const first = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!first) {
    return "Assistant";
  }
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

interface OpenAssistant {
  stream: "stdout" | "stderr";
  at: string;
  atMs: number;
  text: string;
  index: number;
}

function flushAssistant(open: OpenAssistant | null, out: ActivityItem[]): void {
  if (!open) {
    return;
  }
  const cleaned = stripToolDuplicateLines(open.text).trim();
  if (!cleaned) {
    return;
  }
  const isErr = open.stream === "stderr";
  out.push({
    id: `assistant-${open.index}-${open.atMs}`,
    at: open.at,
    atMs: open.atMs,
    phase: "agent",
    kind: isErr ? "error" : "assistant",
    title: isErr ? "Agent stderr" : assistantTitle(cleaned),
    body: cleaned,
    status: isErr ? "error" : "info",
  });
}

/**
 * Build newest-first activity rows from run SSE events.
 * Coalesces run.agent.output into assistant turns (not one row per token).
 */
export function buildActivityItems(events: RunEvent[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  let lastStateTitle = "";
  let open: OpenAssistant | null = null;
  let assistantIndex = 0;

  const breakAssistant = () => {
    flushAssistant(open, out);
    open = null;
  };

  events.forEach((event, index) => {
    if (event.type === "run.agent.output" && event.data && typeof event.data === "object") {
      const data = event.data as { stream?: string; chunk?: string };
      const stream = data.stream === "stderr" ? "stderr" : "stdout";
      const chunk = typeof data.chunk === "string" ? data.chunk : "";
      if (!chunk) {
        return;
      }
      if (open && open.stream !== stream) {
        breakAssistant();
      }
      if (!open) {
        open = {
          stream,
          at: event.at,
          atMs: parseMs(event.at),
          text: chunk,
          index: assistantIndex++,
        };
      } else {
        open.text += chunk;
      }
      return;
    }

    // Non-output events end the current assistant turn.
    breakAssistant();

    const id =
      event.id != null ? `evt-${event.id}` : `${event.at}-${event.type}-${index}`;
    const atMs = parseMs(event.at);

    if (event.type === "run.created") {
      const state =
        event.data && typeof event.data === "object"
          ? String((event.data as { state?: string }).state ?? "Queued")
          : "Queued";
      out.push({
        id,
        at: event.at,
        atMs,
        phase: null,
        kind: "lifecycle",
        title: `Run queued (${state})`,
        status: "info",
      });
      return;
    }

    if (event.type === "run.state_changed" && event.data && typeof event.data === "object") {
      const data = event.data as { from?: string; to?: string };
      const from = data.from ?? "?";
      const to = data.to ?? "?";
      const title = `${from} → ${to}`;
      if (title === lastStateTitle) {
        return;
      }
      lastStateTitle = title;
      out.push({
        id,
        at: event.at,
        atMs,
        phase: phaseForState(to),
        kind: "lifecycle",
        title,
        status: "info",
      });
      return;
    }

    if (event.type === "run.agent.model" && event.data && typeof event.data === "object") {
      const model = String((event.data as { model?: string }).model ?? "unknown");
      out.push({
        id,
        at: event.at,
        atMs,
        phase: "agent",
        kind: "agent",
        title: `Model · ${model}`,
        status: "info",
      });
      return;
    }

    if (event.type === "run.agent.tool" && event.data && typeof event.data === "object") {
      const data = event.data as {
        phase?: string;
        name?: string;
        callId?: string;
      };
      out.push({
        id,
        at: event.at,
        atMs,
        phase: "agent",
        kind: "tool",
        title: `Tool ${data.phase ?? "event"} · ${data.name ?? "tool"}`,
        ...(data.callId ? { detail: data.callId } : {}),
        status: data.phase === "completed" ? "success" : "info",
      });
      return;
    }

    if (event.type === "run.validation.step" && event.data && typeof event.data === "object") {
      const step = event.data as ValidationStepEventData;
      out.push({
        id,
        at: event.at,
        atMs,
        phase: "validate",
        kind: "validation",
        title: `Validation · ${step.name}`,
        detail: `${step.status} · exit ${step.exitCode ?? "—"}`,
        status:
          step.status === "passed"
            ? "success"
            : step.status === "failed" || step.status === "timed_out"
              ? "error"
              : "warn",
        validation: step,
      });
      return;
    }

    if (event.type === "run.agent.finished" && event.data && typeof event.data === "object") {
      const data = event.data as {
        exitCode?: number;
        durationMs?: number;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalCostUsd?: number | null;
          costSource?: string;
          model?: string;
        } | null;
      };
      const usage = data.usage;
      const costPart =
        usage?.totalCostUsd != null
          ? ` · $${usage.totalCostUsd.toFixed(4)} (${usage.costSource ?? "cost"})`
          : "";
      const tokenPart = usage
        ? ` · ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out`
        : "";
      out.push({
        id,
        at: event.at,
        atMs,
        phase: "agent",
        kind: "agent",
        title: `Agent finished (exit ${data.exitCode ?? "—"})`,
        detail: `${Math.round((data.durationMs ?? 0) / 1000)}s${tokenPart}${costPart}`,
        status: data.exitCode === 0 ? "success" : "error",
      });
      return;
    }

    if (event.type === "run.artifact_written") {
      const path =
        event.data && typeof event.data === "object"
          ? String((event.data as { path?: string }).path ?? "")
          : "";
      out.push({
        id,
        at: event.at,
        atMs,
        phase: "integrate",
        kind: "artifact",
        title: "Handoff written",
        ...(path ? { detail: path } : {}),
        status: "success",
      });
      return;
    }

    if (event.type === "run.awaiting_approval") {
      out.push({
        id,
        at: event.at,
        atMs,
        phase: "integrate",
        kind: "lifecycle",
        title: "Waiting for approval",
        status: "warn",
      });
      return;
    }

    if (event.type === "run.failed") {
      const error =
        event.data && typeof event.data === "object"
          ? String((event.data as { error?: string }).error ?? "Failed")
          : "Failed";
      out.push({
        id,
        at: event.at,
        atMs,
        phase: null,
        kind: "error",
        title: "Run failed",
        detail: error,
        status: "error",
      });
      return;
    }

    if (event.type === "run.finished") {
      const state =
        event.data && typeof event.data === "object"
          ? String((event.data as { state?: string }).state ?? "Finished")
          : "Finished";
      out.push({
        id,
        at: event.at,
        atMs,
        phase: null,
        kind: "lifecycle",
        title: `Run finished · ${state}`,
        status: state === "Succeeded" ? "success" : state === "Failed" ? "error" : "info",
      });
    }
  });

  breakAssistant();

  // Newest activity first so live updates appear at the top of the feed.
  out.reverse();
  return out;
}
