import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ulid } from 'ulid';

import { getAdapter } from '@/agents';
import type { AgentExecuteResult } from '@/agents/adapter/types';
import {
  materializeHandoffAssets,
  readHandoffAssets,
} from '@/agents/handoff-assets';
import { readHandoffIfPresent } from '@/agents/handoff-file';
import { syncProjectFromManifest } from '@/app/project-sync';
import type { GojoPaths } from '@/config/paths';
import { diffNameOnly, execGit } from '@/git/git';
import {
  integrate,
  type IntegrateResult,
  type IntegrationMode,
} from '@/integration/integrator';
import { buildPrDescription } from '@/integration/pr-description';
import { MergeQueue } from '@/integration/queue';
import { extractPrNumber, initialNextCheckAt } from '@/integration/status-reconciler';
import { PlatformChangeFeed } from '@/events/platform-change-feed';
import type { PlatformEventTopic } from '@shared/events';
import { canTransition, isTerminal, RunState } from '@shared/run-states';
import { priorityForTrigger } from '@shared/scheduling';
import {
  extractHandoffImpactItems,
  HANDOFF_SCHEMA_VERSION,
  normalizeAgentHandoff,
  type AgentHandoffReport,
  type HandoffStatus,
} from '@shared/handoff';
import {
  safeParseProjectManifest,
  type InstructionsConfig,
} from '@shared/manifest';
import type { Database } from '@/storage/db';
import { createRepositories } from '@/storage/repositories';
import { createWorkRepositories } from '@/storage/work-repositories';
import type {
  Agent,
  Attempt,
  Project,
  Run,
  RunIntegrationStatus,
  RunTrigger,
} from '@/storage/types';
import { runValidationProfile, type ValidationStepResult } from '@/validation/engine';
import { WorkspaceManager } from '@/workspace/manager';

import { RunEventBus } from './events';
import {
  backoffMsFor,
  maxAttemptsFor,
  parseFailurePolicy,
  sleep,
  type ParsedFailurePolicy,
} from './failure-policy';
import { decideHealEnqueue } from './heal';
import { buildRunImpactRecords } from './impact';
import {
  appendValidationPrompt,
  appendValidationPromptAsShellComments,
  assembleAgentPrompt,
} from './prompt-assembly';

const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

interface ValidationProfileConfig {
  steps?: Array<{ name: string; command: string; timeout?: string }>;
}

interface IntegrationConfig {
  mode?: IntegrationMode;
  targetBranch?: string;
  commitMessage?: string;
  postApprovalMode?: IntegrationMode;
  prTool?: 'gh' | 'tea';
  prLogin?: string;
  prRemote?: string;
  prAutoMerge?: boolean;
  prApiUrl?: string;
  prRepo?: string;
  prMergeStyle?: 'squash' | 'merge' | 'rebase';
}

interface ActiveRunContext {
  controller: AbortController;
  workspacePath?: string;
  branchName?: string;
}

export interface CreateRunInput {
  projectId: string;
  agentId: string;
  scheduleId?: string;
  trigger: RunTrigger;
  idempotencyKey?: string;
  notBeforeAt?: string | null;
  expiresAt?: string | null;
  priority?: number;
  /** When true, create as Queued for the dispatcher (default for enqueueRun). */
  enqueue?: boolean;
}

export function platformTopicsForRunEvent(type: string): PlatformEventTopic[] {
  const topics = new Set<PlatformEventTopic>(['runs', 'work']);
  if (
    type === 'run.created' ||
    type === 'run.state_changed' ||
    type === 'run.awaiting_approval' ||
    type === 'run.finished' ||
    type === 'run.failed'
  ) {
    topics.add('dashboard');
    topics.add('overview');
    topics.add('queue');
    topics.add('agents');
    topics.add('projects');
    if (type === 'run.created') topics.add('schedules');
  }
  if (type === 'run.finished' || type === 'run.failed' || type === 'run.accounting_error') {
    topics.add('impact');
  }
  return [...topics];
}

export class RunCoordinator {
  private readonly paths: GojoPaths;
  private readonly workspace: WorkspaceManager;
  private readonly eventBus: RunEventBus;
  private readonly platformEvents: PlatformChangeFeed | null;
  private readonly mergeQueue = new MergeQueue();
  private readonly repos;
  private readonly db: Database;
  private readonly work;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly apiBaseUrl: string | null;
  private readonly issueAgentToken:
    | ((runId: string) => { token: string; id: string } | null)
    | null;
  private readonly revokeAgentToken: ((tokenId: string) => void) | null;

  constructor(deps: {
    db: Database;
    paths: GojoPaths;
    workspace: WorkspaceManager;
    eventBus?: RunEventBus;
    platformEvents?: PlatformChangeFeed;
    apiBaseUrl?: string;
    issueAgentToken?: (runId: string) => { token: string; id: string } | null;
    revokeAgentToken?: (tokenId: string) => void;
  }) {
    this.paths = deps.paths;
    this.db = deps.db;
    this.workspace = deps.workspace;
    this.eventBus = deps.eventBus ?? new RunEventBus();
    this.platformEvents = deps.platformEvents ?? null;
    this.repos = createRepositories(deps.db);
    this.work = createWorkRepositories(deps.db);
    this.apiBaseUrl = deps.apiBaseUrl ?? null;
    this.issueAgentToken = deps.issueAgentToken ?? null;
    this.revokeAgentToken = deps.revokeAgentToken ?? null;
  }

  async createRun(input: CreateRunInput): Promise<Run> {
    const idempotencyKey = input.idempotencyKey ?? ulid();

    const existing = this.repos.runs.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const initialState =
      input.enqueue || input.trigger !== 'schedule'
        ? RunState.Queued
        : RunState.Scheduled;

    const project = this.repos.projects.findById(input.projectId);
    const agent = this.repos.agents.findById(input.agentId);
    if (!project || !agent) {
      throw new Error("Project or agent not found");
    }
    const profile = agent.profileId
      ? this.repos.profiles.findById(agent.profileId)
      : null;
    const schedule = input.scheduleId
      ? this.repos.schedules.findById(input.scheduleId)
      : null;
    const run = this.db.transaction(() => {
      let created = this.repos.runs.create({
        projectId: input.projectId,
        agentId: input.agentId,
        ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {}),
        idempotencyKey,
        trigger: input.trigger,
        state: initialState,
        notBeforeAt: input.notBeforeAt ?? new Date().toISOString(),
        expiresAt: input.expiresAt ?? null,
        priority: input.priority ?? priorityForTrigger(input.trigger),
      });
      const workItem = this.work.items.create({
        projectId: project.id,
        kind: "run",
        nativeKey: created.id,
        title: agent.name,
        summary: agent.description,
        execution: workExecutionForRunState(created.state),
        outcome: workOutcomeForRunState(created.state),
        attention: workAttentionForRunState(created.state),
        provenance: "gojo-agent",
        actorName: profile?.name ?? profile?.adapter ?? null,
        profileId: agent.profileId,
        nativeState: created.state,
        nativeJson: JSON.stringify({ trigger: created.trigger }),
        syncState: "current",
      });
      created =
        this.repos.runs.update(created.id, { workItemId: workItem.id }) ?? created;
      const profileConfig = profile?.configJson ?? "{}";
      const parsedProfile = parseJsonObject(profileConfig);
      this.work.runContexts.create({
        runId: created.id,
        workItemId: workItem.id,
        agentName: agent.name,
        agentDescription: agent.description,
        prompt: agent.prompt,
        manifestHash: createHash("sha256").update(project.manifestJson).digest("hex"),
        instructions: JSON.stringify(readInstructions(project) ?? {}),
        profileJson: profileConfig,
        adapter: profile?.adapter ?? null,
        model:
          typeof parsedProfile["model"] === "string" ? parsedProfile["model"] : null,
        validationJson: agent.validationProfileJson,
        integrationJson: agent.integrationJson,
        failurePolicyJson: agent.failurePolicyJson,
        baseBranch:
          parseIntegrationConfig(agent.integrationJson).targetBranch ?? project.defaultBranch,
        scheduleJson: schedule ? JSON.stringify(schedule) : null,
      });
      return created;
    });

    this.emit('run.created', run.id, { state: run.state });
    return run;
  }

  /**
   * Enqueue a run for the admission dispatcher. Does not start execution.
   * Cron-triggered runs should pass notBeforeAt / expiresAt.
   */
  async enqueueRun(input: CreateRunInput): Promise<Run> {
    return this.createRun({ ...input, enqueue: true });
  }

  async executeRun(runId: string, signal?: AbortSignal): Promise<Run> {
    let run = this.repos.runs.findById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.state !== RunState.Scheduled && run.state !== RunState.Queued) {
      throw new Error(`Run ${runId} is not executable from state ${run.state}`);
    }

    const controller = new AbortController();
    const context: ActiveRunContext = { controller };
    this.activeRuns.set(runId, context);

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      if (run.state === RunState.Scheduled) {
        run = await this.transitionRun(run, RunState.Queued);
      }
      run = await this.transitionRun(run, RunState.Preparing);
      if (!run.startedAt) {
        run =
          this.repos.runs.update(run.id, { startedAt: new Date().toISOString() }) ?? run;
        this.syncWorkFromRun(run);
      }

      let project = this.repos.projects.findById(run.projectId);
      let agent = this.repos.agents.findById(run.agentId);
      if (!project || !agent) {
        return this.failRun(run, 'Project or agent not found');
      }

      const syncBeforeRun = readSyncBeforeRun(project);
      const baseBranch = (() => {
        const integration = parseIntegrationConfig(agent!.integrationJson);
        return integration.targetBranch ?? project!.defaultBranch;
      })();

      if (syncBeforeRun) {
        await this.workspace.syncBaseBranch(project.repoPath, baseBranch);
        syncProjectFromManifest(this.repos, project);
        project = this.repos.projects.findById(run.projectId) ?? project;
        agent = this.repos.agents.findById(run.agentId) ?? agent;
      }

      const integration = parseIntegrationConfig(agent.integrationJson);
      const validation = parseValidationConfig(agent.validationProfileJson);
      const failurePolicy = parseFailurePolicy(agent.failurePolicyJson);
      const maxAttempts = maxAttemptsFor(failurePolicy);

      let lastFailureMessage = 'Run failed';
      let attempt: Attempt | null = null;
      let workspacePath = '';
      let branchName = '';
      let validationResults: ValidationStepResult[] = [];

      for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
        if (attemptNumber > 1) {
          const delay = backoffMsFor(failurePolicy, attemptNumber);
          if (delay > 0) {
            try {
              await sleep(delay, controller.signal);
            } catch {
              return this.terminalRun(run, RunState.Canceled);
            }
          }
          const current = this.repos.runs.findById(run.id) ?? run;
          if (current.state !== RunState.Preparing) {
            run = await this.transitionRun(current, RunState.Preparing);
          } else {
            run = current;
          }
        }

        const workspace = await this.workspace.prepareAttempt({
          repoPath: project.repoPath,
          baseBranch: integration.targetBranch ?? project.defaultBranch,
          runId: run.id,
          projectName: project.name,
          agentName: agent.name,
          attemptNumber,
          // Coordinator already synced above when configured; still prefer origin/
          // so a dirty primary checkout cannot block worktree creation.
          syncBeforeRun: false,
          useRemoteBase: syncBeforeRun,
        });

        workspacePath = workspace.worktreePath;
        branchName = workspace.branchName;
        context.workspacePath = workspacePath;
        context.branchName = branchName;

        attempt = this.repos.attempts.create({
          runId: run.id,
          attemptNumber,
          workspacePath,
          branchName,
          startingCommit: workspace.startingCommit,
          agentAdapter: resolveAdapterName(agent, this.repos.profiles),
          state: 'pending',
        });

        run = await this.transitionRun(
          this.repos.runs.findById(run.id) ?? run,
          RunState.Running,
        );
        attempt =
          this.repos.attempts.update(attempt.id, {
            state: 'running',
            startedAt: new Date().toISOString(),
          }) ?? attempt;

        const agentResult = await this.executeAgent(
          run.id,
          attempt.id,
          agent,
          workspacePath,
          controller.signal,
          validation.steps ?? [],
          readInstructions(project),
        );

        if (controller.signal.aborted || agentResult.canceled) {
          this.finishAttempt(attempt, 'canceled', agentResult);
          await this.cleanupWorkspace(workspacePath, branchName, false);
          return this.terminalRun(run, RunState.Canceled);
        }

        if (agentResult.timedOut) {
          this.finishAttempt(attempt, 'timed_out', agentResult);
          await this.cleanupWorkspace(workspacePath, branchName, false);
          return this.terminalRun(run, RunState.TimedOut);
        }

        if (agentResult.exitCode !== 0) {
          this.finishAttempt(attempt, 'failed', agentResult);
          lastFailureMessage = `Agent exited with code ${agentResult.exitCode}`;
          await this.cleanupWorkspace(workspacePath, branchName, false);
          if (attemptNumber < maxAttempts) {
            continue;
          }
          return this.failRun(run, lastFailureMessage, {
            project,
            agent,
            failurePolicy,
            phase: 'agent',
            exitCode: agentResult.exitCode,
          });
        }

        attempt = this.finishAttempt(attempt, 'succeeded', agentResult);

        run = await this.transitionRun(run, RunState.Validating);
        const runIdForValidation = run.id;
        const validationResult = await runValidationProfile({
          cwd: workspacePath,
          steps: validation.steps ?? [],
          signal: controller.signal,
          onStep: (step) => {
            this.persistValidation(attempt!.id, step);
            this.emit('run.validation.step', runIdForValidation, step);
          },
        });
        validationResults = validationResult.results;

        if (!validationResult.passed) {
          this.writeValidationArtifact(run.id, validationResult.results);
          lastFailureMessage = formatValidationFailureMessage(validationResult.results);
          await this.cleanupWorkspace(workspacePath, branchName, false);
          if (attemptNumber < maxAttempts) {
            continue;
          }
          return this.failRun(run, lastFailureMessage, {
            project,
            agent,
            failurePolicy,
            phase: 'validation',
            validationResults: validationResult.results,
          });
        }

        // Success path — leave attempt/workspace for integration below.
        break;
      }

      if (!attempt) {
        return this.failRun(run, lastFailureMessage, { project, agent, failurePolicy });
      }

      const mode = integration.mode ?? 'none';

      if (mode === 'await-approval') {
        const commitResult = await integrate({
          mode: 'await-approval',
          projectId: project.id,
          worktreePath: workspacePath,
          repoPath: project.repoPath,
          targetBranch: integration.targetBranch ?? project.defaultBranch,
          branchName,
          commitMessage: buildCommitMessage(agent, run, integration),
          runId: run.id,
          mergeQueue: this.mergeQueue,
        });

        if (commitResult.commitSha) {
          attempt =
            this.repos.attempts.update(attempt.id, {
              resultCommit: commitResult.commitSha,
            }) ?? attempt;
        }

        run = await this.transitionRun(run, RunState.AwaitingApproval);
        this.emit('run.awaiting_approval', run.id);
        return run;
      }

      if (mode === 'none') {
        run = await this.transitionRun(run, RunState.Reporting);
        const artifact = await this.writeHandoffArtifact(
          run,
          attempt,
          project,
          agent,
          validationResults,
        );
        this.recordImpactItems(run, attempt, artifact.handoff, artifact.filesChanged);
        await this.cleanupWorkspace(workspacePath, branchName, true);
        return this.terminalRun(run, RunState.Succeeded);
      }

      return this.integrateAndFinish({
        run,
        attempt,
        project,
        agent,
        integration,
        validationResults,
        workspacePath,
        branchName,
        mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = this.repos.runs.findById(runId);
      if (current && !isTerminal(current.state)) {
        // Throws during Preparing are almost always workspace prep / base sync.
        const phase =
          current.state === RunState.Preparing ? 'workspace' : 'other';
        return this.failRun(current, message, { phase });
      }
      throw error;
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active) {
      active.controller.abort();
    }

    const run = this.repos.runs.findById(runId);
    if (!run || isTerminal(run.state)) {
      return;
    }

    if (
      run.state === RunState.Scheduled ||
      run.state === RunState.Queued ||
      run.state === RunState.AwaitingApproval
    ) {
      this.terminalRun(run, RunState.Canceled);
      return;
    }

    if (active) {
      return;
    }

    this.terminalRun(run, RunState.Canceled);
  }

  updateProgress(
    runId: string,
    input: {
      title: string;
      summary: string;
      blockedReason?: string | null;
      references?: string[];
    },
  ): Run {
    const run = this.repos.runs.findById(runId);
    if (!run || !run.workItemId) {
      throw new Error(`Run not found: ${runId}`);
    }
    const existing = this.work.items.findById(run.workItemId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }
    let previousNative: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(existing.nativeJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        previousNative = parsed as Record<string, unknown>;
      }
    } catch {
      previousNative = {};
    }
    const focusParts = [input.title.trim(), input.summary.trim()].filter(
      (part, index, parts) => part.length > 0 && parts.indexOf(part) === index,
    );
    this.work.items.update(run.workItemId, {
      // Keep durable run identity (task name); progress is the live focus line.
      summary: focusParts.join(" — "),
      attention: input.blockedReason ? "blocked" : workAttentionForRunState(run.state),
      nativeJson: JSON.stringify({
        ...previousNative,
        blockedReason: input.blockedReason ?? null,
        references: input.references ?? [],
        focusTitle: input.title,
        focusSummary: input.summary,
      }),
    });
    this.emit("run.progress", run.id, input);
    return run;
  }

  async approveRun(runId: string): Promise<void> {
    let run = this.repos.runs.findById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.state !== RunState.AwaitingApproval) {
      throw new Error(`Run ${runId} is not awaiting approval`);
    }

    const project = this.repos.projects.findById(run.projectId);
    const agent = this.repos.agents.findById(run.agentId);
    if (!project || !agent) {
      this.failRun(run, 'Project or agent not found');
      return;
    }

    const attempts = this.repos.attempts.listByRun(run.id);
    const attempt = attempts[attempts.length - 1];
    if (!attempt?.workspacePath || !attempt.branchName) {
      this.failRun(run, 'Attempt workspace missing');
      return;
    }

    const integration = parseIntegrationConfig(agent.integrationJson);
    const postMode = integration.postApprovalMode ?? 'auto-merge';

    await this.integrateAndFinish({
      run,
      attempt,
      project,
      agent,
      integration,
      validationResults: [],
      workspacePath: attempt.workspacePath,
      branchName: attempt.branchName,
      mode: postMode,
    });
  }

  async rejectRun(runId: string, reason?: string): Promise<void> {
    const run = this.repos.runs.findById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.state !== RunState.AwaitingApproval) {
      throw new Error(`Run ${runId} is not awaiting approval`);
    }

    const attempts = this.repos.attempts.listByRun(run.id);
    const attempt = attempts[attempts.length - 1];
    if (attempt?.workspacePath && attempt.branchName) {
      await this.cleanupWorkspace(attempt.workspacePath, attempt.branchName, false);
    }

    this.failRun(run, reason ?? 'Rejected by operator');
  }

  async recoverInterrupted(): Promise<number> {
    const runs = this.repos.runs.listNonTerminal();
    let recovered = 0;

    for (const run of runs) {
      if (this.activeRuns.has(run.id)) {
        continue;
      }

      switch (run.state) {
        case RunState.Scheduled:
        case RunState.Queued:
        case RunState.Preparing: {
          this.repos.runs.update(run.id, { state: RunState.Queued });
          const updated = this.repos.runs.findById(run.id);
          if (updated) this.syncWorkFromRun(updated);
          recovered += 1;
          break;
        }
        case RunState.Running:
        case RunState.Validating:
        case RunState.Integrating:
        case RunState.Reporting:
        case RunState.AwaitingApproval:
          await this.abandonRun(run);
          recovered += 1;
          break;
        default:
          break;
      }
    }

    return recovered;
  }

  private async integrateAndFinish(input: {
    run: Run;
    attempt: Attempt;
    project: Project;
    agent: Agent;
    integration: IntegrationConfig;
    validationResults: ValidationStepResult[];
    workspacePath: string;
    branchName: string;
    mode: IntegrationMode;
  }): Promise<Run> {
    let { run, attempt } = input;

    run = await this.transitionRun(run, RunState.Integrating);

    const fallbackTitle = buildCommitMessage(input.agent, run, input.integration);
    const rawHandoff = resolveAttemptHandoff(attempt, input.workspacePath);
    // Runtime-validate the agent handoff; fall back to raw only when invalid
    // so lenient asset/summary extraction still works.
    const normalizedHandoff = normalizeAgentHandoff(rawHandoff);
    const handoff = normalizedHandoff.report ?? rawHandoff;
    const pr =
      input.mode === 'pull-request'
        ? buildPrDescription({
            agentName: input.agent.name,
            runId: run.id,
            fallbackTitle,
            handoff,
            workspacePath: input.workspacePath,
          })
        : null;

    const result = await integrate({
      mode: input.mode,
      projectId: input.project.id,
      worktreePath: input.workspacePath,
      repoPath: input.project.repoPath,
      targetBranch: input.integration.targetBranch ?? input.project.defaultBranch,
      branchName: input.branchName,
      commitMessage: pr?.title ?? fallbackTitle,
      runId: run.id,
      ...(pr
        ? {
            prTitle: pr.title,
            prBody: pr.body,
          }
        : {}),
      ...(input.integration.prTool ? { prTool: input.integration.prTool } : {}),
      ...(input.integration.prLogin ? { prLogin: input.integration.prLogin } : {}),
      ...(input.integration.prRemote ? { prRemote: input.integration.prRemote } : {}),
      ...(input.integration.prAutoMerge !== undefined
        ? { prAutoMerge: input.integration.prAutoMerge }
        : {}),
      ...(input.integration.prApiUrl ? { prApiUrl: input.integration.prApiUrl } : {}),
      ...(input.integration.prRepo ? { prRepo: input.integration.prRepo } : {}),
      ...(input.integration.prMergeStyle
        ? { prMergeStyle: input.integration.prMergeStyle }
        : {}),
      mergeQueue: this.mergeQueue,
    });

    if (result.commitSha || result.prUrl) {
      attempt =
        this.repos.attempts.update(attempt.id, {
          ...(result.commitSha ? { resultCommit: result.commitSha } : {}),
          ...(result.prUrl ? { prUrl: result.prUrl } : {}),
        }) ?? attempt;
    }

    this.recordIntegrationOutcome({
      run,
      attempt,
      mode: input.mode,
      integration: input.integration,
      result,
    });

    if (result.conflict) {
      await this.cleanupWorkspace(input.workspacePath, input.branchName, false);
      return this.terminalRun(run, RunState.Conflict);
    }

    if (input.mode === 'pull-request' && result.prCreated === false) {
      const tool = input.integration.prTool ?? 'gh';
      await this.writeHandoffArtifact(
        run,
        attempt,
        input.project,
        input.agent,
        input.validationResults,
        result,
      );
      await this.cleanupWorkspace(input.workspacePath, input.branchName, true, true);
      return this.failRun(
        run,
        `Pull request create failed via ${tool}. Branch ${input.branchName} may already be pushed; placeholder ${result.prUrl ?? 'local://pr/' + input.branchName}. Restart gojo after install if prTool was recently added, then check ${tool} auth.`,
        {
          project: input.project,
          agent: input.agent,
          phase: 'integration',
          validationResults: input.validationResults,
        },
      );
    }

    run = await this.transitionRun(run, RunState.Reporting);
    const artifact = await this.writeHandoffArtifact(
      run,
      attempt,
      input.project,
      input.agent,
      input.validationResults,
      result,
    );
    this.recordImpactItems(run, attempt, artifact.handoff, artifact.filesChanged);

    const keepBranch = input.mode === 'commit-only' || input.mode === 'pull-request';
    await this.cleanupWorkspace(input.workspacePath, input.branchName, true, keepBranch);

    return this.terminalRun(run, RunState.Succeeded);
  }

  /** Persist the canonical integration outcome for a run. Never fails the run. */
  private recordIntegrationOutcome(input: {
    run: Run;
    attempt: Attempt;
    mode: IntegrationMode;
    integration: IntegrationConfig;
    result: IntegrateResult;
  }): void {
    const { result } = input;

    let status: RunIntegrationStatus;
    if (result.conflict) {
      status = 'conflict';
    } else if (input.mode === 'auto-merge') {
      status = 'merged';
    } else if (input.mode === 'pull-request') {
      if (result.prCreated === null) {
        // No commit landed — valid no-change outcome (PRD §25.11).
        return;
      }
      status = result.prCreated ? 'open' : 'failed';
    } else if (result.commitSha) {
      status = 'committed';
    } else {
      // Nothing observable happened; keep accounting empty.
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const realPrUrl =
      result.prUrl && !result.prUrl.startsWith('local://') ? result.prUrl : null;
    const provider =
      input.mode === 'pull-request'
        ? input.integration.prTool === 'tea'
          ? 'forgejo'
          : 'github'
        : null;

    try {
      this.repos.runIntegrations.upsertForRun({
        runId: input.run.id,
        attemptId: input.attempt.id,
        mode: input.mode,
        provider,
        apiUrl: input.integration.prApiUrl ?? null,
        repo: input.integration.prRepo ?? null,
        prNumber: realPrUrl ? extractPrNumber(realPrUrl) : null,
        prUrl: result.prUrl ?? null,
        status,
        autoMergeRequested: input.integration.prAutoMerge ?? false,
        commitSha: result.commitSha,
        ...(status === 'open'
          ? { openedAt: nowIso, nextCheckAt: initialNextCheckAt(now) }
          : {}),
        ...(status === 'merged' ? { mergedAt: nowIso } : {}),
      });
      const source = this.work.sources
        .listByProject(input.run.projectId)
        .find((candidate) => candidate.kind === "repository");
      const prNumber = realPrUrl ? extractPrNumber(realPrUrl) : null;
      if (source && (prNumber || realPrUrl)) {
        const externalWork = this.work.items.upsertExternal({
          projectId: input.run.projectId,
          sourceId: source.id,
          kind: "pull-request",
          nativeKey: String(prNumber ?? realPrUrl),
          title: prNumber ? `Pull request #${prNumber}` : "Pull request",
          delivery:
            status === "open"
              ? "open"
              : status === "merged"
                ? "merged"
                : status === "conflict"
                  ? "blocked"
                  : "closed",
          outcome:
            status === "merged"
              ? "succeeded"
              : status === "open"
                ? "pending"
                : "failed",
          attention: status === "conflict" ? "blocked" : "none",
          provenance: "gojo-agent",
          nativeState: status,
          nativeJson: JSON.stringify({ provider, repo: input.integration.prRepo ?? null }),
          webUrl: realPrUrl,
          observedAt: nowIso,
          nextSyncAt: status === "open" ? initialNextCheckAt(now) : null,
          syncState: status === "open" ? "pending" : "current",
        });
        if (input.run.workItemId) {
          this.work.links.create(input.run.workItemId, externalWork.id, "delivers");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('run.accounting_error', input.run.id, { kind: 'integration', message });
    }
  }

  /** Persist canonical impact items for a succeeded run. Never fails the run. */
  private recordImpactItems(
    run: Run,
    attempt: Attempt,
    handoff: AgentHandoffReport,
    filesChanged: string[],
  ): void {
    try {
      const records = buildRunImpactRecords({
        agentItems: handoff.impact?.items ?? [],
        filesChanged,
      });
      this.repos.runImpactItems.replaceForRun(
        run.id,
        attempt.id,
        records.map((record) => ({
          category: record.category,
          subject: record.subject,
          summary: record.summary,
          source: record.source,
          verification: record.verification,
          confidence: record.confidence,
          evidenceJson: JSON.stringify(record.evidence),
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('run.accounting_error', run.id, { kind: 'impact', message });
    }
  }

  private async executeAgent(
    runId: string,
    attemptId: string,
    agent: Agent,
    workspacePath: string,
    signal: AbortSignal,
    validationSteps: Array<{ name: string; command: string; timeout?: string }> = [],
    instructions?: InstructionsConfig,
  ): Promise<AgentExecuteResult> {
    const adapterName = resolveAdapterName(agent, this.repos.profiles);
    const adapter = getAdapter(adapterName);
    if (!adapter) {
      throw new Error(`Unknown agent adapter: ${adapterName}`);
    }

    const buffers = { stdout: '', stderr: '' };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushOutput = () => {
      flushTimer = null;
      if (buffers.stdout.length > 0) {
        this.emit('run.agent.output', runId, {
          stream: 'stdout',
          chunk: buffers.stdout,
        });
        buffers.stdout = '';
      }
      if (buffers.stderr.length > 0) {
        this.emit('run.agent.output', runId, {
          stream: 'stderr',
          chunk: buffers.stderr,
        });
        buffers.stderr = '';
      }
    };

    const startedAt = Date.now();
    try {
      // Shell: script body + validation comments only (no markdown instructions).
      // AI adapters: notice + instruction files + agent prompt + validation gate.
      const prompt = assembleAgentPrompt({
        taskPrompt: agent.prompt,
        adapterName,
        workspacePath,
        validationSteps,
        progressReporting: this.apiBaseUrl !== null,
        ...(instructions !== undefined ? { instructions } : {}),
      });

      const agentEnv: Record<string, string> = {
        GOJO_AGENT_ID: agent.id,
        GOJO_PROJECT_ID: agent.projectId,
        GOJO_RUN_ID: runId,
      };
      if (this.apiBaseUrl) {
        agentEnv['GOJO_API_URL'] = this.apiBaseUrl;
      }
      const issued = this.issueAgentToken?.(runId);
      if (issued?.token) {
        agentEnv['GOJO_API_TOKEN'] = issued.token;
      }

      try {
        const result = await adapter.execute({
          workspacePath,
          prompt,
          env: agentEnv,
          timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
          signal,
          onOutput: (stream, chunk) => {
            buffers[stream] += chunk;
            if (flushTimer === null) {
              flushTimer = setTimeout(flushOutput, 80);
            }
          },
          onAgentEvent: (event) => {
            if (event.type === 'model') {
              this.emit('run.agent.model', runId, { model: event.model });
              this.repos.attempts.update(attemptId, { model: event.model });
              return;
            }
            this.emit('run.agent.tool', runId, {
              phase: event.phase,
              callId: event.callId,
              name: event.name,
              ...(event.summary !== undefined ? { summary: event.summary } : {}),
            });
          },
        });

        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushOutput();

        this.emit('run.agent.finished', runId, {
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
          stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
          stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
          usage: result.usage ?? null,
        });

        return result;
      } finally {
        if (issued?.id) {
          this.revokeAgentToken?.(issued.id);
        }
      }
    } catch (error) {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushOutput();
      throw error;
    }
  }

  private async transitionRun(run: Run, to: RunState): Promise<Run> {
    if (!canTransition(run.state, to)) {
      throw new Error(`Invalid run transition: ${run.state} -> ${to}`);
    }

    const updated = this.repos.runs.update(run.id, { state: to });
    if (!updated) {
      throw new Error(`Failed to update run ${run.id}`);
    }

    this.syncWorkFromRun(updated);
    this.emit('run.state_changed', run.id, { from: run.state, to });
    return updated;
  }

  private terminalRun(run: Run, state: RunState): Run {
    const from = run.state;
    const updated =
      this.repos.runs.update(run.id, {
        state,
        finishedAt: new Date().toISOString(),
      }) ?? run;
    this.syncWorkFromRun(updated);

    // Emit state_changed so timeline phases close (Reporting → Succeeded, etc.).
    // terminalRun updates state directly and historically only emitted run.finished.
    if (from !== updated.state) {
      this.emit('run.state_changed', updated.id, { from, to: updated.state });
    }
    this.emit('run.finished', updated.id, { state: updated.state });
    return updated;
  }

  private failRun(
    run: Run,
    message: string,
    context?: {
      project?: Project;
      agent?: Agent;
      failurePolicy?: ParsedFailurePolicy;
      phase?: 'agent' | 'validation' | 'integration' | 'workspace' | 'other';
      exitCode?: number | null;
      validationResults?: ValidationStepResult[];
    },
  ): Run {
    const from = run.state;
    const updated =
      this.repos.runs.update(run.id, {
        state: RunState.Failed,
        finishedAt: new Date().toISOString(),
        errorMessage: message,
      }) ?? run;
    this.syncWorkFromRun(updated);

    const project =
      context?.project ?? this.repos.projects.findById(updated.projectId) ?? undefined;
    const agent = context?.agent ?? this.repos.agents.findById(updated.agentId) ?? undefined;
    const failurePolicy =
      context?.failurePolicy ??
      (agent ? parseFailurePolicy(agent.failurePolicyJson) : parseFailurePolicy('{}'));

    this.writeFailureArtifact(updated, message, {
      phase: context?.phase ?? 'other',
      exitCode: context?.exitCode ?? null,
      ...(context?.validationResults
        ? { validationResults: context.validationResults }
        : {}),
      agentName: agent?.name ?? null,
      projectName: project?.name ?? null,
    });

    if (from !== updated.state) {
      this.emit('run.state_changed', updated.id, { from, to: updated.state });
    }
    this.emit('run.failed', updated.id, { error: message });
    this.emit('run.finished', updated.id, { state: updated.state });

    if (project && agent) {
      this.maybeEnqueueHealer(updated, agent, failurePolicy);
    }

    return updated;
  }

  private writeFailureArtifact(
    run: Run,
    message: string,
    details: {
      phase: string;
      exitCode: number | null;
      validationResults?: ValidationStepResult[];
      agentName: string | null;
      projectName: string | null;
    },
  ): void {
    const artifactDir = join(this.paths.artifacts, run.id);
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, 'failure.json');
    writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          runId: run.id,
          projectId: run.projectId,
          projectName: details.projectName,
          agentId: run.agentId,
          agentName: details.agentName,
          trigger: run.trigger,
          state: run.state,
          errorMessage: message,
          phase: details.phase,
          exitCode: details.exitCode,
          finishedAt: run.finishedAt,
          validation: details.validationResults
            ? {
                passed: false,
                steps: details.validationResults,
              }
            : null,
        },
        null,
        2,
      ),
      'utf8',
    );
    this.emit('run.artifact_written', run.id, { path: artifactPath });
  }

  private maybeEnqueueHealer(
    failedRun: Run,
    failedAgent: Agent,
    policy: ParsedFailurePolicy,
  ): void {
    const decision = decideHealEnqueue({
      repos: this.repos,
      failedRun,
      failedAgent,
      policy,
    });
    if (!decision.shouldEnqueue || !decision.healerAgentId) {
      return;
    }

    void this.enqueueRun({
      projectId: failedRun.projectId,
      agentId: decision.healerAgentId,
      trigger: 'heal',
      idempotencyKey: `heal:${failedRun.id}:${decision.healerAgentId}`,
    }).then((healerRun) => {
      if (healerRun.workItemId && failedRun.workItemId) {
        this.work.links.create(healerRun.workItemId, failedRun.workItemId, "heals");
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          level: 'error',
          component: 'heal',
          failedRunId: failedRun.id,
          error: message,
        }),
      );
    });
  }

  private async abandonRun(run: Run): Promise<void> {
    const attempts = this.repos.attempts.listByRun(run.id);
    const attempt = attempts[attempts.length - 1];
    if (attempt?.workspacePath && attempt.branchName) {
      try {
        await this.cleanupWorkspace(attempt.workspacePath, attempt.branchName, false);
      } catch {
        // Best-effort cleanup for orphaned worktrees.
      }
    }

    this.terminalRun(run, RunState.Abandoned);
  }

  private finishAttempt(
    attempt: Attempt,
    state: Attempt['state'],
    result: AgentExecuteResult,
  ): Attempt {
    const usage = result.usage;
    return (
      this.repos.attempts.update(attempt.id, {
        state,
        exitCode: result.exitCode,
        finishedAt: new Date().toISOString(),
        ...(result.version !== undefined ? { agentVersion: result.version } : {}),
        ...(result.handoff !== undefined
          ? { handoffJson: JSON.stringify(result.handoff) }
          : {}),
        ...(usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheWriteTokens: usage.cacheWriteTokens,
              totalCostUsd: usage.totalCostUsd,
              costSource: usage.costSource,
              usageJson: JSON.stringify(usage),
              model: usage.model ?? null,
              agentDurationMs: usage.durationMs ?? null,
            }
          : {}),
      }) ?? attempt
    );
  }

  private async cleanupWorkspace(
    workspacePath: string,
    branchName: string,
    success: boolean,
    keepBranch = false,
  ): Promise<void> {
    if (!success) {
      return;
    }

    try {
      await this.workspace.cleanup(workspacePath, branchName, {
        keepBranch,
      });
    } catch {
      // Worktree may already be removed during recovery.
    }
  }

  private writeValidationArtifact(runId: string, results: ValidationStepResult[]): void {
    const artifactDir = join(this.paths.artifacts, runId);
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, 'validation.json');
    writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          passed: false,
          steps: results,
        },
        null,
        2,
      ),
      'utf8',
    );
    this.emit('run.artifact_written', runId, { path: artifactPath });
  }

  private async writeHandoffArtifact(
    run: Run,
    attempt: Attempt,
    project: Project,
    agent: Agent,
    validationResults: ValidationStepResult[],
    integrationResult?: {
      commitSha: string | null;
      prUrl: string | null;
      prAutoMergeError?: string | null;
    },
  ): Promise<{ handoff: AgentHandoffReport; filesChanged: string[] }> {
    const artifactDir = join(this.paths.artifacts, run.id);
    mkdirSync(artifactDir, { recursive: true });

    const filesChanged = attempt.workspacePath
      ? await diffNameOnly(attempt.workspacePath, attempt.startingCommit ?? undefined)
      : [];

    let resultCommit = attempt.resultCommit ?? attempt.startingCommit ?? 'unknown';
    if (integrationResult?.commitSha) {
      resultCommit = integrationResult.commitSha;
    } else if (attempt.workspacePath) {
      try {
        const head = await execGit(attempt.workspacePath, ['rev-parse', 'HEAD']);
        if (head.exitCode === 0) {
          resultCommit = head.stdout;
        }
      } catch {
        // Keep stored commit when worktree is gone.
      }
    }

    const platformHandoff: AgentHandoffReport = {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      runId: run.id,
      status: 'completed',
      summary: `Agent ${agent.name} completed for project ${project.name}`,
      startingCommit: attempt.startingCommit ?? 'unknown',
      resultCommit,
      filesChanged,
      validation: {
        passed: validationResults.every((step) => step.status === 'passed'),
        steps: validationResults.map((step) => ({
          name: step.name,
          status:
            step.status === 'passed'
              ? 'passed'
              : step.status === 'failed'
                ? 'failed'
                : 'not-run',
        })),
      },
      decisions: [],
      unresolvedIssues: [],
      recommendedNextActions: [],
      agentAssessment: {
        successful: true,
        confidence: 1,
      },
      ...(integrationResult?.prUrl ? { prUrl: integrationResult.prUrl } : {}),
    };

    const workspacePath = attempt.workspacePath ?? undefined;
    const agentHandoff = workspacePath
      ? resolveAttemptHandoff(attempt, workspacePath)
      : parseAttemptHandoffJson(attempt);
    const merged = mergeAgentHandoff(platformHandoff, agentHandoff);

    // Record why an agent handoff failed schema validation without failing
    // otherwise valid work; raw JSON stays on the attempt for diagnosis.
    const warnings: string[] = [];
    if (agentHandoff !== undefined && agentHandoff !== null) {
      const normalized = normalizeAgentHandoff(agentHandoff);
      if (!normalized.report) {
        warnings.push(
          ...normalized.warnings.map((warning) => `handoff-validation: ${warning}`),
        );
      }
    }
    const autoMergeWarning = integrationResult?.prAutoMergeError?.trim();
    if (autoMergeWarning) {
      warnings.push(`prAutoMerge: ${autoMergeWarning}`);
    }
    const withAutoMergeNote: AgentHandoffReport =
      warnings.length > 0
        ? {
            ...merged,
            unresolvedIssues: [...merged.unresolvedIssues, ...warnings],
          }
        : merged;
    const materialized = materializeHandoffAssets(
      workspacePath,
      artifactDir,
      readHandoffAssets(agentHandoff),
    );
    const handoff: AgentHandoffReport =
      materialized.length > 0
        ? { ...withAutoMergeNote, assets: materialized }
        : withAutoMergeNote;

    const artifactPath = join(artifactDir, 'handoff.json');
    writeFileSync(artifactPath, JSON.stringify(handoff, null, 2), 'utf8');
    this.emit('run.artifact_written', run.id, { path: artifactPath });

    return { handoff, filesChanged: handoff.filesChanged };
  }

  private emit(type: string, runId: string, data?: unknown): void {
    const run = this.repos.runs.findById(runId);
    const at = new Date().toISOString();
    if (type === "run.artifact_written" && run) {
      const path = (data as { path?: unknown } | undefined)?.path;
      if (typeof path === "string") {
        this.persistArtifact(run, path, at);
      }
    }
    const durable =
      type !== "run.agent.output" && run?.workItemId
        ? this.work.events.append({
            projectId: run.projectId,
            workItemId: run.workItemId,
            runId,
            type,
            dataJson: JSON.stringify(data ?? {}),
            source: "gojo",
            occurredAt: at,
          })
        : null;
    const event = {
      ...(durable ? { id: durable.sequence } : {}),
      type,
      runId,
      at,
      ...(data !== undefined ? { data } : {}),
    };
    if (run && type !== 'run.agent.output') {
      this.platformEvents?.append({
        projectId: run.projectId,
        type,
        entityKind: 'run',
        entityId: runId,
        topics: platformTopicsForRunEvent(type),
        data: data ?? {},
        occurredAt: at,
      });
    }
    this.eventBus.emit(event);
  }

  private persistValidation(attemptId: string, result: ValidationStepResult): void {
    const finishedAt = new Date().toISOString();
    const startedAt = new Date(
      new Date(finishedAt).getTime() - Math.max(0, result.durationMs),
    ).toISOString();
    this.db
      .connection()
      .query(
        `INSERT INTO validations (
          id, attempt_id, name, command, exit_code, status,
          started_at, finished_at, output_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        ulid(),
        attemptId,
        result.name,
        result.command,
        result.exitCode,
        result.status,
        startedAt,
        finishedAt,
      );
  }

  private persistArtifact(run: Run, path: string, createdAt: string): void {
    const existing = this.db
      .connection()
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM artifacts WHERE run_id = ? AND path = ? LIMIT 1",
      )
      .get(run.id, path);
    if (existing) return;
    const filename = path.split("/").pop() ?? "artifact";
    const kind = filename.endsWith(".json")
      ? filename.slice(0, -".json".length)
      : "artifact";
    const attempt = this.repos.attempts.listByRun(run.id).at(-1);
    this.db
      .connection()
      .query(
        `INSERT INTO artifacts (
          id, run_id, attempt_id, kind, path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ulid(), run.id, attempt?.id ?? null, kind, path, createdAt);
  }

  /** Keep the run's work item axes in sync with run state (also used by the dispatcher). */
  syncWorkFromRun(run: Run): void {
    if (!run.workItemId) return;
    this.work.items.update(run.workItemId, {
      execution: workExecutionForRunState(run.state),
      outcome: workOutcomeForRunState(run.state),
      attention: workAttentionForRunState(run.state),
      nativeState: run.state,
      lastError: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.finishedAt,
      syncState: "current",
      observedAt: new Date().toISOString(),
    });
  }
}

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function workExecutionForRunState(state: RunState) {
  switch (state) {
    case RunState.Scheduled:
    case RunState.Queued:
      return "queued" as const;
    case RunState.Preparing:
      return "preparing" as const;
    case RunState.Running:
      return "running" as const;
    case RunState.Validating:
      return "validating" as const;
    case RunState.AwaitingApproval:
      return "awaiting-approval" as const;
    case RunState.Integrating:
      return "integrating" as const;
    case RunState.Reporting:
      return "reporting" as const;
    default:
      return "terminal" as const;
  }
}

function workOutcomeForRunState(state: RunState) {
  if (state === RunState.Succeeded) return "succeeded" as const;
  if (
    state === RunState.Canceled ||
    state === RunState.Skipped ||
    state === RunState.Superseded ||
    state === RunState.Abandoned
  ) {
    return "canceled" as const;
  }
  if (isTerminal(state)) return "failed" as const;
  return "pending" as const;
}

function workAttentionForRunState(state: RunState) {
  if (state === RunState.AwaitingApproval) return "approval" as const;
  if (state === RunState.Blocked || state === RunState.Conflict) return "blocked" as const;
  return "none" as const;
}

function parseValidationConfig(json: string): ValidationProfileConfig {
  try {
    return JSON.parse(json) as ValidationProfileConfig;
  } catch {
    return {};
  }
}

function readSyncBeforeRun(project: Project): boolean {
  try {
    const raw = JSON.parse(project.manifestJson || '{}') as unknown;
    const parsed = safeParseProjectManifest(raw);
    if (parsed.success) {
      return parsed.data.repository.syncBeforeRun;
    }
  } catch {
    // ignore
  }
  return false;
}

function readInstructions(project: Project): InstructionsConfig | undefined {
  try {
    const raw = JSON.parse(project.manifestJson || '{}') as unknown;
    const parsed = safeParseProjectManifest(raw);
    if (parsed.success) {
      return parsed.data.instructions;
    }
  } catch {
    // ignore
  }
  return undefined;
}

const VALIDATION_OUTPUT_TAIL_CHARS = 400;

export { appendValidationPrompt, appendValidationPromptAsShellComments };

/** Build a durable operator-facing message from failed validation steps. */
export function formatValidationFailureMessage(results: ValidationStepResult[]): string {
  const failed =
    results.find((step) => step.status !== 'passed') ?? results[results.length - 1];
  if (!failed) {
    return 'Validation failed';
  }

  const exitPart =
    failed.exitCode !== null && failed.exitCode !== undefined
      ? `, exit ${failed.exitCode}`
      : '';
  const output = [failed.stderr, failed.stdout]
    .filter((part) => part.trim().length > 0)
    .join('\n')
    .trim();
  const tail =
    output.length > VALIDATION_OUTPUT_TAIL_CHARS
      ? output.slice(-VALIDATION_OUTPUT_TAIL_CHARS)
      : output;

  if (tail.length === 0) {
    return `Validation failed: ${failed.name} (${failed.status}${exitPart})`;
  }

  const compact = tail.replace(/\s+/g, ' ').trim();
  return `Validation failed: ${failed.name} (${failed.status}${exitPart}): ${compact}`;
}

function parseIntegrationConfig(json: string): IntegrationConfig {
  try {
    return JSON.parse(json) as IntegrationConfig;
  } catch {
    return {};
  }
}

function buildCommitMessage(
  agent: Agent,
  run: Run,
  integration: IntegrationConfig,
): string {
  return integration.commitMessage ?? `gojo: ${agent.name} (${run.id})`;
}

function parseAttemptHandoffJson(attempt: Attempt): unknown | undefined {
  if (!attempt.handoffJson) {
    return undefined;
  }
  try {
    return JSON.parse(attempt.handoffJson) as unknown;
  } catch {
    return undefined;
  }
}

function resolveAttemptHandoff(attempt: Attempt, workspacePath: string): unknown {
  const fromDb = parseAttemptHandoffJson(attempt);
  if (fromDb !== undefined) {
    return fromDb;
  }
  return readHandoffIfPresent(workspacePath);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

const HANDOFF_STATUSES = new Set<HandoffStatus>([
  'completed',
  'partial',
  'failed',
  'no-change',
]);

/** Merge agent-written handoff fields onto the platform baseline (keeps runId/commits/validation). */
function mergeAgentHandoff(
  platform: AgentHandoffReport,
  agent: unknown,
): AgentHandoffReport {
  if (!agent || typeof agent !== 'object') {
    return platform;
  }
  const obj = agent as Record<string, unknown>;
  const impact = extractHandoffImpactItems(agent);
  const status =
    typeof obj['status'] === 'string' && HANDOFF_STATUSES.has(obj['status'] as HandoffStatus)
      ? (obj['status'] as HandoffStatus)
      : platform.status;
  const summary =
    typeof obj['summary'] === 'string' && obj['summary'].trim()
      ? obj['summary'].trim()
      : platform.summary;
  const assessment =
    obj['agentAssessment'] && typeof obj['agentAssessment'] === 'object'
      ? (obj['agentAssessment'] as { successful?: unknown; confidence?: unknown })
      : null;

  const unresolvedIssues = Array.isArray(obj['unresolvedIssues'])
    ? asStringList(obj['unresolvedIssues'])
    : platform.unresolvedIssues;

  return {
    ...platform,
    status,
    summary,
    unresolvedIssues: impact.invalid
      ? [
          ...unresolvedIssues,
          'handoff-validation: impact section failed validation and was ignored',
        ]
      : unresolvedIssues,
    ...(Array.isArray(obj['decisions'])
      ? { decisions: asStringList(obj['decisions']) }
      : {}),
    ...(Array.isArray(obj['recommendedNextActions'])
      ? { recommendedNextActions: asStringList(obj['recommendedNextActions']) }
      : {}),
    ...(Array.isArray(obj['filesChanged']) && asStringList(obj['filesChanged']).length > 0
      ? { filesChanged: asStringList(obj['filesChanged']) }
      : {}),
    ...(assessment &&
    typeof assessment.successful === 'boolean' &&
    typeof assessment.confidence === 'number'
      ? {
          agentAssessment: {
            successful: assessment.successful,
            confidence: Math.min(1, Math.max(0, assessment.confidence)),
          },
        }
      : {}),
    ...(impact.items.length > 0 ? { impact: { items: impact.items } } : {}),
  };
}

function resolveAdapterName(
  agent: Agent,
  profiles: ReturnType<typeof createRepositories>['profiles'],
): string {
  if (agent.profileId) {
    const profile = profiles.findById(agent.profileId);
    if (profile) {
      return profile.adapter;
    }
  }

  return 'shell';
}
