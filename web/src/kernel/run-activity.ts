import type { PhaseKey } from "@/kernel/run-phases";
import type { RunEvent, ValidationStepEventData } from "@/contexts/execution/types";

export type ActivityKind =
  | "lifecycle"
  | "agent"
  | "assistant"
  | "tool"
  | "validation"
  | "artifact"
  | "error";

export interface ActivityToolEntry {
  callId: string;
  name: string;
  summary?: string;
  phase: "started" | "completed";
}

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
  /** Collapsed tool group entries (when kind === "tool"). */
  tools?: ActivityToolEntry[];
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

interface OpenToolGroup {
  id: string;
  at: string;
  atMs: number;
  /** Insertion order of callIds. */
  order: string[];
  byCallId: Map<string, ActivityToolEntry>;
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

function isShellToolName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "shell" || n === "bash";
}

function toolGroupTitle(tools: ActivityToolEntry[]): string {
  if (tools.length === 0) {
    return "Tools";
  }
  if (tools.length === 1) {
    const tool = tools[0]!;
    return tool.summary ? `${tool.name} · ${tool.summary}` : tool.name;
  }

  const allShell = tools.every((t) => isShellToolName(t.name));
  if (allShell) {
    const summaries = tools
      .map((t) => t.summary)
      .filter((s): s is string => Boolean(s));
    const preview = summaries.slice(0, 2).join(", ");
    const more = summaries.length > 2 ? "…" : "";
    const label = `${tools.length} shells`;
    return preview ? `${label} · ${preview}${more}` : label;
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    names.push(tool.name);
    if (names.length >= 4) {
      break;
    }
  }
  const distinct = new Set(tools.map((t) => t.name)).size;
  const preview = names.join(", ");
  const suffix = distinct > names.length ? `${preview}…` : preview;
  return `${tools.length} tools · ${suffix}`;
}

function flushToolGroup(open: OpenToolGroup | null, out: ActivityItem[]): void {
  if (!open || open.order.length === 0) {
    return;
  }
  const tools = open.order
    .map((callId) => open.byCallId.get(callId))
    .filter((entry): entry is ActivityToolEntry => entry != null);
  if (tools.length === 0) {
    return;
  }
  const allDone = tools.every((t) => t.phase === "completed");
  const summaries = tools
    .map((t) => t.summary)
    .filter((s): s is string => Boolean(s));
  out.push({
    id: open.id,
    at: open.at,
    atMs: open.atMs,
    phase: "agent",
    kind: "tool",
    title: toolGroupTitle(tools),
    ...(tools.length > 1 && summaries.length === 1
      ? { detail: summaries[0] }
      : {}),
    status: allDone ? "success" : "info",
    tools,
  });
}

/**
 * Build newest-first activity rows from run WebSocket events.
 * Coalesces run.agent.output into assistant turns (not one row per token).
 * Pairs tool started/completed by callId and collapses consecutive tools.
 */
export function buildActivityItems(events: RunEvent[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  let lastStateTitle = "";
  let open: OpenAssistant | null = null;
  let openTools: OpenToolGroup | null = null;
  let assistantIndex = 0;
  let toolGroupIndex = 0;

  const breakAssistant = () => {
    flushAssistant(open, out);
    open = null;
  };

  const breakTools = () => {
    flushToolGroup(openTools, out);
    openTools = null;
  };

  events.forEach((event, index) => {
    if (event.type === "run.agent.output" && event.data && typeof event.data === "object") {
      const data = event.data as { stream?: string; chunk?: string };
      const stream = data.stream === "stderr" ? "stderr" : "stdout";
      const chunk = typeof data.chunk === "string" ? data.chunk : "";
      if (!chunk) {
        return;
      }
      // Adapter-injected `[tool …]` markers must not flush tool groups or create
      // empty assistant turns — otherwise consecutive shells each become a row.
      const substantive = stripToolDuplicateLines(chunk).trim();
      if (!substantive) {
        return;
      }
      // Real assistant/stderr text ends the current tool group.
      breakTools();
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

    if (event.type === "run.agent.tool" && event.data && typeof event.data === "object") {
      const data = event.data as {
        phase?: string;
        name?: string;
        callId?: string;
        summary?: string;
      };
      const callId =
        typeof data.callId === "string" && data.callId
          ? data.callId
          : `anon-${index}`;
      const name = typeof data.name === "string" && data.name ? data.name : "tool";
      const phase = data.phase === "completed" ? "completed" : "started";
      const summary =
        typeof data.summary === "string" && data.summary.trim()
          ? data.summary.trim()
          : undefined;

      if (!openTools) {
        openTools = {
          id: `tools-${toolGroupIndex++}-${atMs}`,
          at: event.at,
          atMs,
          order: [],
          byCallId: new Map(),
        };
      }

      const existing = openTools.byCallId.get(callId);
      if (!existing) {
        openTools.order.push(callId);
        openTools.byCallId.set(callId, {
          callId,
          name,
          phase,
          ...(summary ? { summary } : {}),
        });
      } else {
        existing.phase = phase === "completed" ? "completed" : existing.phase;
        if (name && name !== "tool") {
          existing.name = name;
        }
        if (summary) {
          existing.summary = summary;
        }
      }
      return;
    }

    // Any other event closes the current tool group.
    breakTools();

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
  breakTools();

  // Newest activity first so live updates appear at the top of the feed.
  out.reverse();
  return out;
}
