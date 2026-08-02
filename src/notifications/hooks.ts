import { parseJson } from "@shared/json";

import type { AppContext } from "@/app/context";
import type { NotificationChannel } from "@/notifications/dispatcher";
import { resolveRunHandoffSummary } from "@/runs/inspect";
import { recordRunOutcome } from "@/storage/schedule-outcomes";
import { getInstanceSetting } from "@/storage/instance-settings";
import type { Agent } from "@/storage/types";
import { isTerminal, RunState } from "@shared/run-states";
import {
  safeParseNotificationsConfig,
  safeParseProjectManifest,
  type NotificationsConfig,
} from "@shared/manifest";

interface ChannelConfigMap {
  [name: string]: {
    type: NotificationChannel["type"];
    webhookUrl?: string;
    botToken?: string;
    chatId?: string;
    config?: Record<string, unknown>;
  };
}

function loadChannels(ctx: AppContext): ChannelConfigMap {
  const value = getInstanceSetting(ctx.db, "notification_channels");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as ChannelConfigMap;
}

function resolveChannel(
  name: string,
  channels: ChannelConfigMap,
): NotificationChannel | null {
  const config = channels[name];
  if (!config) {
    return null;
  }

  return {
    id: name,
    type: config.type,
    config: {
      ...(config.config ?? {}),
      ...(config.webhookUrl !== undefined ? { webhookUrl: config.webhookUrl } : {}),
      ...(config.botToken !== undefined ? { botToken: config.botToken } : {}),
      ...(config.chatId !== undefined ? { chatId: String(config.chatId) } : {}),
    },
  };
}

async function enqueueNamedChannels(
  ctx: AppContext,
  runId: string,
  names: string[],
  channels: ChannelConfigMap,
  payload: unknown,
): Promise<void> {
  for (const name of names) {
    const channel = resolveChannel(name, channels);
    if (!channel) {
      continue;
    }
    await ctx.notifications.enqueue(runId, channel, payload);
  }
}

function hasRoutes(config: NotificationsConfig | undefined): boolean {
  if (!config) {
    return false;
  }
  return Boolean(
    config.onSuccess?.length ||
      config.onFailure?.length ||
      config.onDisabled?.length ||
      config.onApprovalNeeded?.length,
  );
}

/** Agent-level routing replaces project-level routing so one agent can notify alone. */
function resolveRouting(
  agent: Agent | null,
  projectRouting: NotificationsConfig | undefined,
): NotificationsConfig | undefined {
  if (!agent?.notificationsJson) {
    return projectRouting;
  }

  const parsed = safeParseNotificationsConfig(parseJson(agent.notificationsJson));
  if (!parsed.success || !hasRoutes(parsed.data)) {
    return projectRouting;
  }
  return parsed.data;
}

export interface NotificationHookHandle {
  unsubscribe: () => void;
  drain: () => Promise<void>;
}

export function wireNotificationHooks(ctx: AppContext): NotificationHookHandle {
  const inflight = new Set<Promise<void>>();
  let active = true;

  const unsubscribe = ctx.eventBus.subscribe((event) => {
    if (
      !active ||
      (event.type !== "run.finished" &&
        event.type !== "run.awaiting_approval")
    ) {
      return;
    }

    let work!: Promise<void>;
    work = (async () => {
      const run = ctx.repos.runs.findById(event.runId);
      if (
        !run ||
        (event.type === "run.finished" && !isTerminal(run.state))
      ) {
        return;
      }

      const project = ctx.repos.projects.findById(run.projectId);
      if (!project) {
        return;
      }

      const parsed = safeParseProjectManifest(
        parseJson(project.manifestJson || "{}"),
      );
      const agent = ctx.repos.agents.findById(run.agentId);
      const notifications = resolveRouting(
        agent,
        parsed.success ? parsed.data.notifications : undefined,
      );
      if (!notifications) {
        return;
      }

      const channels = loadChannels(ctx);
      if (event.type === "run.awaiting_approval") {
        const approvalEventData = event.data as
          | Record<string, unknown>
          | undefined;
        await enqueueNamedChannels(
          ctx,
          run.id,
          notifications.onApprovalNeeded ?? [],
          channels,
          {
            project: project.name,
            agent: agent?.name ?? run.agentId,
            runId: run.id,
            state: "approval-needed",
            approvalId:
              typeof approvalEventData?.["approvalId"] === "string"
                ? approvalEventData["approvalId"]
                : null,
            approveUrl:
              typeof approvalEventData?.["approveUrl"] === "string"
                ? approvalEventData["approveUrl"]
                : null,
            prUrl:
              typeof approvalEventData?.["prUrl"] === "string"
                ? approvalEventData["prUrl"]
                : null,
            reviewerVerdict: approvalEventData?.["reviewerVerdict"] ?? null,
            checksState: approvalEventData?.["checksState"] ?? null,
          },
        );
        return;
      }
      const handoff = resolveRunHandoffSummary(ctx, run.id);
      const basePayload = {
        project: project.name,
        agent: agent?.name ?? run.agentId,
        runId: run.id,
        state: run.state,
        error: run.errorMessage,
        finishedAt: run.finishedAt,
        summary: handoff.summary,
        handoffStatus: handoff.status,
      };

      const outcomeNames =
        run.state === RunState.Succeeded
          ? (notifications.onSuccess ?? [])
          : (notifications.onFailure ?? []);

      if (outcomeNames.length > 0) {
        await enqueueNamedChannels(ctx, run.id, outcomeNames, channels, basePayload);
      }

      if (!run.scheduleId) {
        return;
      }

      const { disabled } = await recordRunOutcome(
        ctx.db,
        run.scheduleId,
        run.state === RunState.Succeeded,
      );

      if (!disabled) {
        return;
      }

      const schedule = ctx.repos.schedules.findById(run.scheduleId);
      const disabledNames = notifications.onDisabled ?? [];
      if (disabledNames.length === 0) {
        return;
      }

      await enqueueNamedChannels(ctx, run.id, disabledNames, channels, {
        ...basePayload,
        reason: "schedule auto-disabled",
        scheduleId: run.scheduleId,
        consecutiveFailures: schedule?.consecutiveFailures ?? null,
      });
    })()
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            level: "error",
            component: "notifications",
            runId: event.runId,
            error: message,
          }),
        );
      })
      .finally(() => {
        inflight.delete(work);
      });

    inflight.add(work);
  });

  return {
    unsubscribe() {
      active = false;
      unsubscribe();
    },
    async drain() {
      active = false;
      unsubscribe();
      await Promise.allSettled([...inflight]);
    },
  };
}
