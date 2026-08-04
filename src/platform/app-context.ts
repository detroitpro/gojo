import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ulid } from "ulid";

import type { InstanceConfig } from "@/platform/config/instance";
import {
  loadInstanceConfig,
  resolveApiBaseUrl,
  saveInstanceConfig,
} from "@/platform/config/instance";
import { ensureLayout, resolvePaths, type GojoPaths } from "@/platform/config/paths";
import { UserService } from "@/contexts/access/infrastructure/auth/users";
import { NotificationDispatcher } from "@/contexts/notifications/infrastructure/dispatcher";
import { wireNotificationHooks } from "@/contexts/notifications/subscribers/run-lifecycle";
import { IntegrationStatusReconciler } from "@/contexts/delivery/application/status-reconciler";
import { PlatformChangeFeed } from "@/platform/events/platform-change-feed";
import { RunCoordinator } from "@/contexts/execution/infrastructure/coordinator";
import { RunDispatcher } from "@/contexts/execution/application/dispatcher";
import { RunEventBus, RunEventHistory } from "@/contexts/execution/infrastructure/events";
import { isTerminal, RunState } from "@shared/run-states";
import { AgentTriggerSchema } from "@shared/manifest";
import type { Approval } from "@shared/approvals";
import {
  extractHandoffSubjectActions,
  recoverAgentHandoffReport,
} from "@shared/handoff";
import {
  fixRoundEscalateReason,
  formatChecksSummary,
  isRetryableFixRoundStall,
  resolveApprovalForIntegration,
  resolveFixRoundSubject,
} from "@/contexts/delivery/domain/fix-rounds";
import { Scheduler } from "@/contexts/scheduling/infrastructure/scheduler-loop";
import { nextOccurrence } from "@/contexts/scheduling/domain/cron";
import { SecretStore } from "@/contexts/access/infrastructure/secrets/store";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database,
  type Repositories
} from "@/infrastructure/persistence";
import {
  createWorkRepositories,
  type WorkRepositories,
} from "@/contexts/work/contract";
import {
  ensureProjectRepositorySource,
  defaultSourceAdapters,
  GenericWebhookIngestor,
  SourceAdapterRegistry,
  SourceSyncService,
} from "@/contexts/work/contract";
import { WorkspaceManager } from "@/contexts/execution/infrastructure/workspace/manager";
import { WorkTriggerService } from "@/contexts/work/application/triggers/service";
import { ApprovalService } from "@/contexts/delivery/application/approval-service";
import {
  createApprovalRepository,
  createControlIntentRepository,
} from "@/contexts/delivery/contract";
import { MergeService } from "@/contexts/delivery/application/merge-service";
import { CommentIntentService } from "@/contexts/delivery/application/comment-intents";
import { createApprovalChangeHandler } from "@/contexts/delivery/subscribers/approval-change";
import { configureTelemetry } from "@/platform/telemetry/otel";

import { isInstancePaused, setInstancePaused } from "@/infrastructure/persistence/instance-settings";

const AGENT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const SESSION_SECRET_NAME = "__gojo_session_secret__";

export interface AppContext {
  paths: GojoPaths;
  db: Database;
  repos: Repositories;
  work: WorkRepositories;
  instance: InstanceConfig;
  instanceConfigPath: string;
  workspace: WorkspaceManager;
  coordinator: RunCoordinator;
  dispatcher: RunDispatcher;
  scheduler: Scheduler;
  notifications: NotificationDispatcher;
  secrets: SecretStore;
  sourceSync: SourceSyncService;
  sourceWebhooks: GenericWebhookIngestor;
  approvals: ApprovalService;
  mergeService: MergeService;
  eventBus: RunEventBus;
  eventHistory: RunEventHistory;
  platformEvents: PlatformChangeFeed;
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
  const work = createWorkRepositories(db);
  const eventBus = new RunEventBus();
  const eventHistory = new RunEventHistory();
  const platformEvents = new PlatformChangeFeed(db);
  eventBus.subscribe((event) => {
    eventHistory.record(event);
  });

  const workspace = new WorkspaceManager(paths.worktrees);
  const secrets = new SecretStore(db, paths);
  for (const project of repos.projects.list()) {
    try {
      ensureProjectRepositorySource(db, project.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "warn",
          component: "sources",
          phase: "repository-discovery",
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  const resolveSourceSecret = (name: string, projectId: string) =>
    secrets.get(name, projectId) ?? secrets.get(name);
  const sourceWebhooks = new GenericWebhookIngestor({
    db,
    resolveSecret: resolveSourceSecret,
    platformEvents,
  });
  const users = new UserService(db);
  users.purgeExpiredApiTokens();
  let apiBaseUrl: string | null = null;
  try {
    apiBaseUrl = resolveApiBaseUrl(instance);
  } catch {
    // Broken network config (e.g. 0.0.0.0 without publicBaseUrl) — CLI can still
    // load context to fix instance.yaml; server start gates refuse to listen.
    apiBaseUrl = null;
  }
  const mergeService = new MergeService({
    db,
    resolveSecret: resolveSourceSecret,
  });
  const coordinator = new RunCoordinator({
    db,
    paths,
    workspace,
    eventBus,
    platformEvents,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    issueAgentToken: (runId) => {
      const admin = users.findFirstAdmin();
      if (!admin) {
        return null;
      }
      const expiresAt = new Date(Date.now() + AGENT_TOKEN_TTL_MS).toISOString();
      const { token, record } = users.createApiTokenForUser(
        admin.id,
        `agent-run-${ulid()}`,
        { expiresAt, scopes: [`run:progress:${runId}`] },
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
    schedulePullRequestAutoMerge: (input) =>
      mergeService.scheduleWhenChecksSucceed(input),
  });
  const workTriggers = new WorkTriggerService({
    db,
    enqueue: (input) => coordinator.enqueueRun(input),
    ...(apiBaseUrl
      ? { runUrl: (runId: string) => `${apiBaseUrl.replace(/\/+$/, "")}/runs/${runId}` }
      : {}),
  });
  const sourceRegistry = new SourceAdapterRegistry(defaultSourceAdapters());
  let commentIntents: CommentIntentService | null = null;
  const sourceSync = new SourceSyncService({
    db,
    registry: sourceRegistry,
    resolveSecret: resolveSourceSecret,
    platformEvents,
    onObserved: async ({ source, connection, adapter, token, workItem, previousLabels }) => {
      await commentIntents?.observe({
        source,
        connection,
        adapter,
        token,
        workItem,
      });
      if (
        workItem.kind !== "issue" ||
        !workItem.nativeKey ||
        !adapter.listLabelActors ||
        !adapter.comment ||
        !adapter.setLabels
      ) {
        return;
      }
      const operation = {
        baseUrl: connection.baseUrl ?? "",
        externalKey: source.externalKey,
        kind: "issue" as const,
        nativeKey: workItem.nativeKey,
        token,
      };
      const labelActors = (await adapter.listLabelActors(operation))
        .filter((event) => event.actor !== null)
        .map((event) => ({
          label: event.label,
          action: event.action === "added" ? ("add" as const) : ("remove" as const),
          actor: event.actor!,
          occurredAt: event.occurredAt,
        }));
      await workTriggers.observe({
        workItemId: workItem.id,
        previousLabels,
        labelActors,
        comment: async (body) => {
          await adapter.comment!({ ...operation, body });
        },
        addLabels: async (labels) => {
          await adapter.setLabels!({ ...operation, add: labels });
        },
      });
    },
  });
  const approvals = new ApprovalService({
    approvals: createApprovalRepository(db),
    intents: createControlIntentRepository(db),
    merge: (approval) => mergeService.merge(approval),
    onChange: createApprovalChangeHandler({
      users,
      work,
      platformEvents,
      eventBus,
      apiBaseUrl,
    }),
  });
  commentIntents = new CommentIntentService({
    db,
    approvals,
    resolveTrustedActors: (projectId) =>
      repos.agents
        .listByProject(projectId)
        .flatMap((agent) => {
          try {
            const trigger = AgentTriggerSchema.safeParse(
              JSON.parse(agent.triggerJson) as unknown,
            );
            return trigger.success && trigger.data.on === "issue-label"
              ? trigger.data.trustedActors
              : [];
          } catch {
            return [];
          }
        }),
    claim: async (workItem, agentName) => {
      const agent = repos.agents
        .listByProject(workItem.projectId)
        .find((candidate) => candidate.enabled && candidate.name === agentName);
      if (!agent) return null;
      const trigger = AgentTriggerSchema.safeParse(
        (() => {
          try {
            return JSON.parse(agent.triggerJson) as unknown;
          } catch {
            return {};
          }
        })(),
      );
      if (!trigger.success || trigger.data.on !== "issue-label") {
        return null;
      }
      const run = await coordinator.enqueueRun({
        projectId: workItem.projectId,
        agentId: agent.id,
        trigger: "work",
        subjectWorkItemId: workItem.id,
        idempotencyKey: `claim:${workItem.id}:${agent.id}`,
      });
      return run.id;
    },
  });
  const notifications = new NotificationDispatcher(db);
  const leaseHolderId = ulid();
  const enqueueFixRound = async (
    approval: Approval,
    feedback: { checksSummary?: string; reviewSummary?: string },
  ): Promise<boolean> => {
    const evidenceAgentId =
      typeof approval.evidence["implementingAgentId"] === "string"
        ? approval.evidence["implementingAgentId"]
        : null;
    const implementingRun = approval.runId
      ? repos.runs.findById(approval.runId)
      : null;
    const implementingAgent = implementingRun
      ? repos.agents.findById(implementingRun.agentId)
      : evidenceAgentId
        ? repos.agents.findById(evidenceAgentId)
        : null;
    const maxRounds =
      typeof approval.evidence["fixRounds"] === "number"
        ? approval.evidence["fixRounds"]
        : 0;
    const resumeBranch =
      typeof approval.evidence["resumeBranch"] === "string"
        ? approval.evidence["resumeBranch"]
        : null;
    const originalContext = implementingRun
      ? work.runContexts.findByRun(implementingRun.id)
      : null;
    const originalSubject = (() => {
      try {
        return originalContext?.subjectJson
          ? (JSON.parse(originalContext.subjectJson) as { workItemId?: string })
          : null;
      } catch {
        return null;
      }
    })();
    const subjectWorkItemId = resolveFixRoundSubject({
      originalSubjectWorkItemId: originalSubject?.workItemId,
      approvalWorkItemId: approval.workItemId,
    });
    const escalateReason = fixRoundEscalateReason({
      hasImplementingRun: Boolean(implementingRun || evidenceAgentId),
      hasImplementingAgent: Boolean(implementingAgent),
      attempts: approval.attempts,
      maxRounds,
      resumeBranch,
      subjectWorkItemId,
    });
    if (escalateReason || !implementingAgent || !resumeBranch || !subjectWorkItemId) {
      approvals.escalate(
        approval.id,
        escalateReason ?? "Fix-round subject is unavailable",
        feedback,
      );
      return false;
    }
    const next = approvals.beginFixRound(approval.id, feedback);
    const fixRun = await coordinator.enqueueRun({
      projectId: approval.projectId,
      agentId: implementingAgent.id,
      trigger: "work",
      idempotencyKey: `fix:${approval.workItemId ?? subjectWorkItemId}:${implementingAgent.id}:${next.attempts}`,
      subjectWorkItemId,
      resumeBranch,
      subjectFeedback: {
        round: next.attempts,
        ...feedback,
      },
    });
    approvals.assignRun(approval.id, fixRun.id);
    return true;
  };
  const resolveApproval = (integration: {
    runId: string;
    prUrl: string | null;
  }): Approval | null =>
    resolveApprovalForIntegration({
      integrationRunId: integration.runId,
      integrationPrUrl: integration.prUrl,
      findByRun: (runId) => approvals.findByRun(runId),
      findBySubject: (subjectType, subjectId) =>
        approvals.findBySubject(subjectType, subjectId),
      findWorkItemByWebUrl: (webUrl) => work.items.findByWebUrl(webUrl),
      findAttemptPrUrl: (runId) =>
        repos.attempts
          .listByRun(runId)
          .map((attempt) => attempt.prUrl)
          .find((value): value is string => Boolean(value)) ?? null,
    });
  const integrationReconciler = new IntegrationStatusReconciler({
    db,
    platformEvents,
    fetchStatus: async (integration) => {
      const run = repos.runs.findById(integration.runId);
      let approval = resolveApproval(integration);
      let workItem = approval?.workItemId
        ? work.items.findById(approval.workItemId)
        : null;
      if (!workItem) {
        const prUrl =
          integration.prUrl ??
          repos.attempts
            .listByRun(integration.runId)
            .map((attempt) => attempt.prUrl)
            .find((value): value is string => Boolean(value)) ??
          null;
        workItem = prUrl ? work.items.findByWebUrl(prUrl) : null;
        if (approval && workItem) {
          approval = approvals.attachWorkItem(approval.id, workItem.id);
        }
      }
      if (!run || !workItem) return { state: "open" };
      return mergeService.getPullRequestState(run.projectId, workItem.id);
    },
    fetchChecks: async (integration) => {
      let approval = resolveApproval(integration);
      if (approval && !approval.workItemId) {
        const prUrl =
          integration.prUrl ??
          repos.attempts
            .listByRun(integration.runId)
            .map((attempt) => attempt.prUrl)
            .find((value): value is string => Boolean(value)) ??
          null;
        const item = prUrl ? work.items.findByWebUrl(prUrl) : null;
        if (item) approval = approvals.attachWorkItem(approval.id, item.id);
      }
      if (!approval?.workItemId) {
        return { status: "pending", checks: [] };
      }
      return mergeService.getChecks(approval.projectId, approval.workItemId);
    },
    onChecksSettled: async (integration, checks) => {
      const approval = resolveApproval(integration);
      if (!approval) return;
      if (approval.checksState === checks.status) return;
      await approvals.recordChecks(approval.id, checks.status, {
        checks: checks.checks,
        observedAt: new Date().toISOString(),
      });

      const evidenceAgentId =
        typeof approval.evidence["implementingAgentId"] === "string"
          ? approval.evidence["implementingAgentId"]
          : null;
      const evidenceAgentName =
        typeof approval.evidence["implementingAgentName"] === "string"
          ? approval.evidence["implementingAgentName"]
          : null;
      const implementingRun = repos.runs.findById(integration.runId);
      const implementingAgent = implementingRun
        ? repos.agents.findById(implementingRun.agentId)
        : evidenceAgentId
          ? repos.agents.findById(evidenceAgentId)
          : evidenceAgentName
            ? repos.agents
                .listByProject(approval.projectId)
                .find((agent) => agent.name === evidenceAgentName) ?? null
            : null;
      if (!implementingAgent) {
        approvals.escalate(approval.id, "Implementing run or agent no longer exists");
        return;
      }

      const project = repos.projects.findById(approval.projectId);
      if (!project?.enabled) {
        return;
      }

      if (checks.status === "failure") {
        await enqueueFixRound(approval, {
          checksSummary: formatChecksSummary(checks.checks),
        });
        return;
      }

      // Native / policy auto-merge: recordChecks already advanced the approval.
      if (approval.autonomy === "auto") {
        return;
      }

      const reviewer = repos.agents
        .listByProject(approval.projectId)
        .find((agent) => {
          const parsed = AgentTriggerSchema.safeParse(
            (() => {
              try {
                return JSON.parse(agent.triggerJson) as unknown;
              } catch {
                return {};
              }
            })(),
          );
          return (
            agent.enabled &&
            parsed.success &&
            parsed.data.on === "pull-request-checks-settled" &&
            parsed.data.fromAgents.includes(implementingAgent.name)
          );
        });
      if (!reviewer || !approval.workItemId) {
        approvals.escalate(approval.id, "No checks-settled reviewer agent is configured");
        return;
      }
      await coordinator.enqueueRun({
        projectId: approval.projectId,
        agentId: reviewer.id,
        trigger: "work",
        idempotencyKey: `review:${approval.id}:${approval.attempts}`,
        subjectWorkItemId: approval.workItemId,
        ...(typeof approval.evidence["resumeBranch"] === "string"
          ? { resumeBranch: approval.evidence["resumeBranch"] }
          : {}),
      });
    },
  });
  const dispatcher = new RunDispatcher({ db, coordinator });

  const applySubjectActions = async (
    workItemId: string,
    actions: {
      addLabels?: string[] | undefined;
      removeLabels?: string[] | undefined;
      comment?: string | undefined;
    },
  ): Promise<void> => {
    const workItem = work.items.findById(workItemId);
    const source = workItem?.sourceId ? work.sources.findById(workItem.sourceId) : null;
    const connection = source?.connectionId
      ? work.connections.findById(source.connectionId)
      : null;
    const adapter = connection ? sourceRegistry.get(connection.adapter) : null;
    if (!workItem?.nativeKey || !source || !connection || !adapter) return;
    const config = (() => {
      try {
        return JSON.parse(connection.configJson) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const tokenName =
      typeof config["tokenSecretName"] === "string" ? config["tokenSecretName"] : null;
    const token = tokenName
      ? resolveSourceSecret(tokenName, workItem.projectId)
      : connection.adapter === "github"
        ? process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"] ?? null
        : process.env["FORGEJO_TOKEN"] ?? process.env["GITEA_TOKEN"] ?? null;
    const operation = {
      baseUrl: connection.baseUrl ?? "",
      externalKey: source.externalKey,
      kind: workItem.kind === "issue" ? ("issue" as const) : ("pull-request" as const),
      nativeKey: workItem.nativeKey,
      token,
    };
    if (
      adapter.setLabels &&
      ((actions.addLabels?.length ?? 0) > 0 || (actions.removeLabels?.length ?? 0) > 0)
    ) {
      const labels = await adapter.setLabels({
        ...operation,
        add: actions.addLabels ?? [],
        remove: actions.removeLabels ?? [],
      });
      work.items.update(workItem.id, { labels });
    }
    if (adapter.comment && actions.comment?.trim()) {
      await adapter.comment({ ...operation, body: actions.comment.trim() });
    }
  };

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

  eventBus.subscribe((event) => {
    if (event.type !== "run.finished") return;
    void (async () => {
      const run = repos.runs.findById(event.runId);
      const agent = run ? repos.agents.findById(run.agentId) : null;
      if (!run || !agent) return;
      const trigger = AgentTriggerSchema.safeParse(
        (() => {
          try {
            return JSON.parse(agent.triggerJson) as unknown;
          } catch {
            return {};
          }
        })(),
      );
      if (!trigger.success) return;
      const context = work.runContexts.findByRun(run.id);
      const subject = (() => {
        try {
          return context?.subjectJson
            ? (JSON.parse(context.subjectJson) as { workItemId?: string })
            : null;
        } catch {
          return null;
        }
      })();
      if (!subject?.workItemId) return;
      const approval = approvals.findBySubject("pull-request", subject.workItemId);
      if (!approval) return;
      const attempt = repos.attempts.listByRun(run.id).at(-1);
      const rawHandoff = (() => {
        try {
          return attempt?.handoffJson
            ? (JSON.parse(attempt.handoffJson) as unknown)
            : null;
        } catch {
          return null;
        }
      })();
      const recovered = rawHandoff
        ? recoverAgentHandoffReport(rawHandoff)
        : { report: null, warnings: [] as string[] };
      const subjectActions =
        recovered.report?.subjectActions ??
        (rawHandoff ? extractHandoffSubjectActions(rawHandoff) : null);
      if (
        trigger.data.on === "issue-label" &&
        (run.state !== RunState.Succeeded || !subjectActions)
      ) {
        await applySubjectActions(subject.workItemId, {
          addLabels: ["gojo:blocked"],
          removeLabels: ["gojo:in-progress"],
          comment:
            "Gojo could not complete this claimed issue. The claim was released and the issue was marked blocked; inspect the linked run before retrying.",
        });
        return;
      }
      if (subjectActions) {
        await applySubjectActions(subject.workItemId, subjectActions);
      }
      if (trigger.data.on !== "pull-request-checks-settled") return;
      if (!subjectActions?.verdict) {
        approvals.escalate(
          approval.id,
          "Reviewer finished without a valid subjectActions verdict",
        );
        return;
      }
      const verdict = subjectActions.verdict;
      const summary =
        recovered.report?.summary ??
        (typeof (rawHandoff as { summary?: unknown } | null)?.summary ===
        "string"
          ? (rawHandoff as { summary: string }).summary
          : "");
      const unresolvedIssues = recovered.report?.unresolvedIssues ?? [];
      await approvals.recordReview(approval.id, verdict, {
        reviewerRunId: run.id,
        summary,
        unresolvedIssues,
      });
      if (verdict === "changes-requested") {
        await enqueueFixRound(approvals.findById(approval.id) ?? approval, {
          reviewSummary: subjectActions.comment ?? summary,
        });
      }
    })().catch((error) => {
      console.error(
        JSON.stringify({
          level: "error",
          component: "approvals",
          phase: "review-handoff",
          runId: event.runId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });

  const recoverStuckFixRounds = async (): Promise<void> => {
    const stuck = approvals.list({
      state: "awaiting-human",
      limit: 50,
      offset: 0,
    });
    for (const approval of stuck.items) {
      if (
        !isRetryableFixRoundStall({
          state: approval.state,
          reviewVerdict: approval.reviewVerdict,
          lastError: approval.lastError,
          evidence: approval.evidence,
        })
      ) {
        continue;
      }
      // Mark before enqueue so a crash mid-retry does not loop forever.
      const marked = approvals.patchEvidence(approval.id, {
        fixRoundStallRetried: true,
      });
      const review =
        typeof marked.evidence["review"] === "object" &&
        marked.evidence["review"] !== null
          ? (marked.evidence["review"] as { summary?: unknown })
          : null;
      const feedback = {
        ...(typeof review?.summary === "string"
          ? { reviewSummary: review.summary }
          : {}),
      };
      await enqueueFixRound(marked, feedback);
    }
  };

  const scheduler = new Scheduler({
    db,
    leaseHolderId,
    isPaused: () => isInstancePaused(db),
    reconcileIntegrations: async (now) => {
      const summary = await integrationReconciler.reconcile(now);
      await recoverStuckFixRounds();
      return summary;
    },
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

      const agent = repos.agents.findById(schedule.agentId);
      if (!agent || !agent.enabled) {
        return;
      }

      const project = repos.projects.findById(agent.projectId);
      if (!project || !project.enabled) {
        return;
      }

      const expiresAt =
        nextOccurrence(schedule.cronExpr, schedule.timezone, fireAt)?.toISOString() ?? null;

      await coordinator.enqueueRun({
        projectId: project.id,
        agentId: agent.id,
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
    work,
    instance,
    instanceConfigPath,
    workspace,
    coordinator,
    dispatcher,
    scheduler,
    notifications,
    secrets,
    sourceSync,
    sourceWebhooks,
    approvals,
    mergeService,
    eventBus,
    eventHistory,
    platformEvents,
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
      await sourceSync.stop();
      eventHistory.clear();
      platformEvents.close();
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
  sourceSync.start();

  return ctx;
}

export { computeScheduleNextRun } from "@/contexts/scheduling/contract";

export { RunEventHistory };
