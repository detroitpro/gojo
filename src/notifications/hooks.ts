import type { AppContext } from "@/app/context";
import type { NotificationChannel } from "@/notifications/dispatcher";
import { isTerminal, RunState } from "@shared/run-states";
import { safeParseProjectManifest } from "@shared/manifest";

interface ChannelConfigMap {
  [name: string]: {
    type: NotificationChannel["type"];
    webhookUrl?: string;
    config?: Record<string, unknown>;
  };
}

function loadChannels(ctx: AppContext): ChannelConfigMap {
  const row = ctx.db
    .connection()
    .query<{ value_json: string }, [string]>(
      "SELECT value_json FROM instance_settings WHERE key = ?",
    )
    .get("notification_channels");

  if (!row) {
    return {};
  }

  try {
    return JSON.parse(row.value_json) as ChannelConfigMap;
  } catch {
    return {};
  }
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
    },
  };
}

export interface NotificationHookHandle {
  unsubscribe: () => void;
  drain: () => Promise<void>;
}

export function wireNotificationHooks(ctx: AppContext): NotificationHookHandle {
  const inflight = new Set<Promise<void>>();
  let active = true;

  const unsubscribe = ctx.eventBus.subscribe((event) => {
    if (!active || event.type !== "run.finished") {
      return;
    }

    let work!: Promise<void>;
    work = (async () => {
      const run = ctx.repos.runs.findById(event.runId);
      if (!run || !isTerminal(run.state)) {
        return;
      }

      const project = ctx.repos.projects.findById(run.projectId);
      if (!project) {
        return;
      }

      let manifestRaw: unknown = {};
      try {
        manifestRaw = JSON.parse(project.manifestJson || "{}") as unknown;
      } catch {
        return;
      }

      const parsed = safeParseProjectManifest(manifestRaw);
      const notifications = parsed.success ? parsed.data.notifications : undefined;
      if (!notifications) {
        return;
      }

      const success =
        run.state === RunState.Succeeded
          ? notifications.onSuccess
          : notifications.onFailure;
      const names = success ?? [];
      if (names.length === 0) {
        return;
      }

      const channels = loadChannels(ctx);
      const task = ctx.repos.tasks.findById(run.taskId);
      const payload = {
        project: project.name,
        task: task?.name ?? run.taskId,
        runId: run.id,
        state: run.state,
        error: run.errorMessage,
        finishedAt: run.finishedAt,
      };

      for (const name of names) {
        const channel = resolveChannel(name, channels);
        if (!channel) {
          continue;
        }
        await ctx.notifications.enqueue(run.id, channel, payload);
      }
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
