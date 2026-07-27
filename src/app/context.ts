import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ulid } from "ulid";

import type { InstanceConfig } from "@/config/instance";
import {
  loadInstanceConfig,
  saveInstanceConfig,
} from "@/config/instance";
import { ensureLayout, resolvePaths, type GojoPaths } from "@/config/paths";
import { UserService } from "@/auth/users";
import { NotificationDispatcher } from "@/notifications/dispatcher";
import { wireNotificationHooks } from "@/notifications/hooks";
import { IntegrationStatusReconciler } from "@/integration/status-reconciler";
import { RunCoordinator } from "@/runs/coordinator";
import { RunDispatcher } from "@/runs/dispatcher";
import { RunEventBus, RunEventHistory } from "@/runs/events";
import { isTerminal } from "@shared/run-states";
import { Scheduler } from "@/scheduler/scheduler";
import { nextOccurrence } from "@/scheduler/cron";
import { SecretStore } from "@/secrets/store";
import { Database, createRepositories, type Repositories } from "@/storage";
import { WorkspaceManager } from "@/workspace/manager";
import { configureTelemetry } from "@/telemetry/otel";

import { isInstancePaused, setInstancePaused } from "./instance-settings";

const AGENT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const SESSION_SECRET_NAME = "__gojo_session_secret__";

export interface AppContext {
  paths: GojoPaths;
  db: Database;
  repos: Repositories;
  instance: InstanceConfig;
  instanceConfigPath: string;
  workspace: WorkspaceManager;
  coordinator: RunCoordinator;
  dispatcher: RunDispatcher;
  scheduler: Scheduler;
  notifications: NotificationDispatcher;
  secrets: SecretStore;
  eventBus: RunEventBus;
  eventHistory: RunEventHistory;
  leaseHolderId: string;
  getSessionSecret(): string;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  setTelemetryEnabled(enabled: boolean): void;
  saveInstanceConfig(): void;
  dispose(): Promise<void>;
}

export async function createAppContext(home?: string): Promise<AppContext> {
  const paths = resolvePaths(home);
  ensureLayout(paths.home);

  const db = Database.open(paths.db);
  db.migrate();

  const instanceConfigPath = join(paths.config, "instance.yaml");
  let instance = loadInstanceConfig(instanceConfigPath, paths.data);
  setInstancePaused(db, instance.paused);

  const repos = createRepositories(db);
  const eventBus = new RunEventBus();
  const eventHistory = new RunEventHistory();
  eventBus.subscribe((event) => {
    eventHistory.record(event);
  });

  const workspace = new WorkspaceManager(paths.worktrees);
  const secrets = new SecretStore(db, paths);
  const users = new UserService(db);
  users.purgeExpiredApiTokens();
  const apiBaseUrl = `http://${instance.bindHost}:${instance.bindPort}/api/v1`;
  const coordinator = new RunCoordinator({
    db,
    paths,
    workspace,
    eventBus,
    apiBaseUrl,
    issueAgentToken: () => {
      const admin = users.findFirstAdmin();
      if (!admin) {
        return null;
      }
      const expiresAt = new Date(Date.now() + AGENT_TOKEN_TTL_MS).toISOString();
      const { token, record } = users.createApiTokenForUser(
        admin.id,
        `agent-run-${ulid()}`,
        { expiresAt },
      );
      return { token, id: record.id };
    },
    revokeAgentToken: (tokenId) => {
      const admin = users.findFirstAdmin();
      if (!admin) {
        return;
      }
      users.revokeApiToken(admin.id, tokenId);
    },
  });
  const notifications = new NotificationDispatcher(db);
  const leaseHolderId = ulid();
  const integrationReconciler = new IntegrationStatusReconciler({ db });
  const dispatcher = new RunDispatcher({ db, coordinator });

  eventBus.subscribe((event) => {
    if (event.type === "run.created" || event.type === "run.finished") {
      dispatcher.kick();
      return;
    }
    if (event.type === "run.state_changed") {
      const to = (event.data as { to?: string } | undefined)?.to;
      if (to && isTerminal(to as Parameters<typeof isTerminal>[0])) {
        dispatcher.kick();
      }
    }
  });

  const scheduler = new Scheduler({
    db,
    leaseHolderId,
    isPaused: () => isInstancePaused(db),
    reconcileIntegrations: (now) => integrationReconciler.reconcile(now),
    onCancelActive: async (scheduleId) => {
      const active = repos.runs
        .listNonTerminal()
        .filter((run) => run.scheduleId === scheduleId);
      for (const run of active) {
        await coordinator.cancelRun(run.id);
      }
    },
    onTrigger: async (scheduleId, fireAt) => {
      const schedule = repos.schedules.findById(scheduleId);
      if (!schedule || !schedule.enabled) {
        return;
      }

      const task = repos.tasks.findById(schedule.taskId);
      if (!task || !task.enabled) {
        return;
      }

      const project = repos.projects.findById(task.projectId);
      if (!project) {
        return;
      }

      const expiresAt =
        nextOccurrence(schedule.cronExpr, schedule.timezone, fireAt)?.toISOString() ?? null;

      await coordinator.enqueueRun({
        projectId: project.id,
        taskId: task.id,
        scheduleId: schedule.id,
        trigger: "schedule",
        idempotencyKey: `${schedule.id}:${fireAt.toISOString()}`,
        notBeforeAt: fireAt.toISOString(),
        expiresAt,
      });

      dispatcher.kick();
    },
  });

  configureTelemetry({
    enabled: instance.telemetryEnabled,
    serviceName: "gojo",
  });

  let notificationHooks: ReturnType<typeof wireNotificationHooks> | undefined;
  let notificationTimer: ReturnType<typeof setInterval> | undefined;

  const ctx: AppContext = {
    paths,
    db,
    repos,
    instance,
    instanceConfigPath,
    workspace,
    coordinator,
    dispatcher,
    scheduler,
    notifications,
    secrets,
    eventBus,
    eventHistory,
    leaseHolderId,
    getSessionSecret() {
      const existing = secrets.get(SESSION_SECRET_NAME);
      if (existing) {
        return existing;
      }
      const value = randomUUID();
      secrets.set(SESSION_SECRET_NAME, value);
      return value;
    },
    isPaused() {
      return isInstancePaused(db);
    },
    setPaused(paused: boolean) {
      setInstancePaused(db, paused);
      instance.paused = paused;
      saveInstanceConfig(instanceConfigPath, instance);
    },
    setTelemetryEnabled(enabled: boolean) {
      instance.telemetryEnabled = enabled;
      saveInstanceConfig(instanceConfigPath, instance);
      configureTelemetry({
        enabled,
        serviceName: "gojo",
      });
    },
    saveInstanceConfig() {
      saveInstanceConfig(instanceConfigPath, instance);
    },
    async dispose() {
      if (notificationTimer) {
        clearInterval(notificationTimer);
        notificationTimer = undefined;
      }
      await notificationHooks?.drain();
      await dispatcher.stop();
      await scheduler.stop();
      eventHistory.clear();
      db.close();
    },
  };

  notificationHooks = wireNotificationHooks(ctx);
  notificationTimer = setInterval(() => {
    void notifications.processQueue().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("closed database")) {
        return;
      }
      console.error(
        JSON.stringify({
          level: "error",
          component: "notifications",
          error: message,
        }),
      );
    });
  }, 15_000);

  await coordinator.recoverInterrupted();

  return ctx;
}

export function computeScheduleNextRun(cronExpr: string, timezone: string, from = new Date()): string | null {
  return nextOccurrence(cronExpr, timezone, from)?.toISOString() ?? null;
}

export { RunEventHistory };
