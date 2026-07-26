import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { integrate, type IntegrationMode } from '@/integration/integrator';
import { buildPrDescription } from '@/integration/pr-description';
import { MergeQueue } from '@/integration/queue';
import { canTransition, isTerminal, RunState } from '@shared/run-states';
import type { AgentHandoffReport, HandoffStatus } from '@shared/handoff';
import {
  safeParseProjectManifest,
  type InstructionsConfig,
} from '@shared/manifest';
import type { Database } from '@/storage/db';
import { createRepositories } from '@/storage/repositories';
import type { Attempt, Project, Run, RunTrigger, Task } from '@/storage/types';
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
}

interface ActiveRunContext {
  controller: AbortController;
  workspacePath?: string;
  branchName?: string;
}

export interface CreateRunInput {
  projectId: string;
  taskId: string;
  scheduleId?: string;
  trigger: RunTrigger;
  idempotencyKey?: string;
}

export class RunCoordinator {
  private readonly paths: GojoPaths;
  private readonly workspace: WorkspaceManager;
  private readonly eventBus: RunEventBus;
  private readonly mergeQueue = new MergeQueue();
  private readonly repos;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly apiBaseUrl: string | null;
  private readonly issueAgentToken: (() => { token: string; id: string } | null) | null;
  private readonly revokeAgentToken: ((tokenId: string) => void) | null;

  constructor(deps: {
    db: Database;
    paths: GojoPaths;
    workspace: WorkspaceManager;
    eventBus?: RunEventBus;
    apiBaseUrl?: string;
    issueAgentToken?: () => { token: string; id: string } | null;
    revokeAgentToken?: (tokenId: string) => void;
  }) {
    this.paths = deps.paths;
    this.workspace = deps.workspace;
    this.eventBus = deps.eventBus ?? new RunEventBus();
    this.repos = createRepositories(deps.db);
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
      input.trigger === 'schedule' ? RunState.Scheduled : RunState.Queued;

    const run = this.repos.runs.create({
      projectId: input.projectId,
      taskId: input.taskId,
      ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {}),
      idempotencyKey,
      trigger: input.trigger,
      state: initialState,
    });

    this.emit('run.created', run.id, { state: run.state });
    return run;
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
      }

      let project = this.repos.projects.findById(run.projectId);
      let task = this.repos.tasks.findById(run.taskId);
      if (!project || !task) {
        return this.failRun(run, 'Project or task not found');
      }

      const syncBeforeRun = readSyncBeforeRun(project);
      const baseBranch = (() => {
        const integration = parseIntegrationConfig(task!.integrationJson);
        return integration.targetBranch ?? project!.defaultBranch;
      })();

      if (syncBeforeRun) {
        await this.workspace.syncBaseBranch(project.repoPath, baseBranch);
        syncProjectFromManifest(this.repos, project);
        project = this.repos.projects.findById(run.projectId) ?? project;
        task = this.repos.tasks.findById(run.taskId) ?? task;
      }

      const integration = parseIntegrationConfig(task.integrationJson);
      const validation = parseValidationConfig(task.validationProfileJson);
      const failurePolicy = parseFailurePolicy(task.failurePolicyJson);
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
          taskName: task.name,
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
          task,
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
            task,
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
            task,
            failurePolicy,
            phase: 'validation',
            validationResults: validationResult.results,
          });
        }

        // Success path — leave attempt/workspace for integration below.
        break;
      }

      if (!attempt) {
        return this.failRun(run, lastFailureMessage, { project, task, failurePolicy });
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
          commitMessage: buildCommitMessage(task, run, integration),
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
        await this.writeHandoffArtifact(run, attempt, project, task, validationResults);
        await this.cleanupWorkspace(workspacePath, branchName, true);
        return this.terminalRun(run, RunState.Succeeded);
      }

      return this.integrateAndFinish({
        run,
        attempt,
        project,
        task,
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

  async approveRun(runId: string): Promise<void> {
    let run = this.repos.runs.findById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.state !== RunState.AwaitingApproval) {
      throw new Error(`Run ${runId} is not awaiting approval`);
    }

    const project = this.repos.projects.findById(run.projectId);
    const task = this.repos.tasks.findById(run.taskId);
    if (!project || !task) {
      this.failRun(run, 'Project or task not found');
      return;
    }

    const attempts = this.repos.attempts.listByRun(run.id);
    const attempt = attempts[attempts.length - 1];
    if (!attempt?.workspacePath || !attempt.branchName) {
      this.failRun(run, 'Attempt workspace missing');
      return;
    }

    const integration = parseIntegrationConfig(task.integrationJson);
    const postMode = integration.postApprovalMode ?? 'auto-merge';

    await this.integrateAndFinish({
      run,
      attempt,
      project,
      task,
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
        case RunState.Preparing:
          this.repos.runs.update(run.id, { state: RunState.Queued });
          recovered += 1;
          break;
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
    task: Task;
    integration: IntegrationConfig;
    validationResults: ValidationStepResult[];
    workspacePath: string;
    branchName: string;
    mode: IntegrationMode;
  }): Promise<Run> {
    let { run, attempt } = input;

    run = await this.transitionRun(run, RunState.Integrating);

    const fallbackTitle = buildCommitMessage(input.task, run, input.integration);
    const handoff = resolveAttemptHandoff(attempt, input.workspacePath);
    const pr =
      input.mode === 'pull-request'
        ? buildPrDescription({
            taskName: input.task.name,
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
      mergeQueue: this.mergeQueue,
    });

    if (result.commitSha) {
      attempt =
        this.repos.attempts.update(attempt.id, {
          resultCommit: result.commitSha,
        }) ?? attempt;
    }

    if (result.conflict) {
      await this.cleanupWorkspace(input.workspacePath, input.branchName, false);
      return this.terminalRun(run, RunState.Conflict);
    }

    run = await this.transitionRun(run, RunState.Reporting);
    await this.writeHandoffArtifact(
      run,
      attempt,
      input.project,
      input.task,
      input.validationResults,
      result,
    );

    const keepBranch = input.mode === 'commit-only' || input.mode === 'pull-request';
    await this.cleanupWorkspace(input.workspacePath, input.branchName, true, keepBranch);

    return this.terminalRun(run, RunState.Succeeded);
  }

  private async executeAgent(
    runId: string,
    attemptId: string,
    task: Task,
    workspacePath: string,
    signal: AbortSignal,
    validationSteps: Array<{ name: string; command: string; timeout?: string }> = [],
    instructions?: InstructionsConfig,
  ): Promise<AgentExecuteResult> {
    const adapterName = resolveAdapterName(task, this.repos.agentProfiles);
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
      // AI adapters: notice + instruction files + task prompt + validation gate.
      const prompt = assembleAgentPrompt({
        taskPrompt: task.prompt,
        adapterName,
        workspacePath,
        validationSteps,
        ...(instructions !== undefined ? { instructions } : {}),
      });

      const agentEnv: Record<string, string> = {
        GOJO_TASK_ID: task.id,
        GOJO_PROJECT_ID: task.projectId,
        GOJO_RUN_ID: runId,
      };
      if (this.apiBaseUrl) {
        agentEnv['GOJO_API_URL'] = this.apiBaseUrl;
      }
      const issued = this.issueAgentToken?.();
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
      task?: Task;
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

    const project =
      context?.project ?? this.repos.projects.findById(updated.projectId) ?? undefined;
    const task = context?.task ?? this.repos.tasks.findById(updated.taskId) ?? undefined;
    const failurePolicy =
      context?.failurePolicy ??
      (task ? parseFailurePolicy(task.failurePolicyJson) : parseFailurePolicy('{}'));

    this.writeFailureArtifact(updated, message, {
      phase: context?.phase ?? 'other',
      exitCode: context?.exitCode ?? null,
      ...(context?.validationResults
        ? { validationResults: context.validationResults }
        : {}),
      taskName: task?.name ?? null,
      projectName: project?.name ?? null,
    });

    if (from !== updated.state) {
      this.emit('run.state_changed', updated.id, { from, to: updated.state });
    }
    this.emit('run.failed', updated.id, { error: message });
    this.emit('run.finished', updated.id, { state: updated.state });

    if (project && task) {
      this.maybeEnqueueHealer(updated, task, failurePolicy);
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
      taskName: string | null;
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
          taskId: run.taskId,
          taskName: details.taskName,
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
    failedTask: Task,
    policy: ParsedFailurePolicy,
  ): void {
    const decision = decideHealEnqueue({
      repos: this.repos,
      failedRun,
      failedTask,
      policy,
    });
    if (!decision.shouldEnqueue || !decision.healerTaskId) {
      return;
    }

    void this.createRun({
      projectId: failedRun.projectId,
      taskId: decision.healerTaskId,
      trigger: 'heal',
      idempotencyKey: `heal:${failedRun.id}:${decision.healerTaskId}`,
    })
      .then((healRun) => this.executeRun(healRun.id))
      .catch((error: unknown) => {
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
    task: Task,
    validationResults: ValidationStepResult[],
    integrationResult?: { commitSha: string | null; prUrl: string | null },
  ): Promise<void> {
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
      schemaVersion: 1,
      runId: run.id,
      status: 'completed',
      summary: `Task ${task.name} completed for project ${project.name}`,
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
    };

    const workspacePath = attempt.workspacePath ?? undefined;
    const agentHandoff = workspacePath
      ? resolveAttemptHandoff(attempt, workspacePath)
      : parseAttemptHandoffJson(attempt);
    const merged = mergeAgentHandoff(platformHandoff, agentHandoff);
    const materialized = materializeHandoffAssets(
      workspacePath,
      artifactDir,
      readHandoffAssets(agentHandoff),
    );
    const handoff: AgentHandoffReport =
      materialized.length > 0 ? { ...merged, assets: materialized } : merged;

    const artifactPath = join(artifactDir, 'handoff.json');
    writeFileSync(artifactPath, JSON.stringify(handoff, null, 2), 'utf8');
    this.emit('run.artifact_written', run.id, { path: artifactPath });
  }

  private emit(type: string, runId: string, data?: unknown): void {
    const event = {
      type,
      runId,
      at: new Date().toISOString(),
      ...(data !== undefined ? { data } : {}),
    };
    this.eventBus.emit(event);
  }
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
  task: Task,
  run: Run,
  integration: IntegrationConfig,
): string {
  return integration.commitMessage ?? `gojo: ${task.name} (${run.id})`;
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

  return {
    ...platform,
    status,
    summary,
    ...(Array.isArray(obj['decisions'])
      ? { decisions: asStringList(obj['decisions']) }
      : {}),
    ...(Array.isArray(obj['unresolvedIssues'])
      ? { unresolvedIssues: asStringList(obj['unresolvedIssues']) }
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
  };
}

function resolveAdapterName(
  task: Task,
  agentProfiles: ReturnType<typeof createRepositories>['agentProfiles'],
): string {
  if (task.agentProfileId) {
    const profile = agentProfiles.findById(task.agentProfileId);
    if (profile) {
      return profile.adapter;
    }
  }

  return 'shell';
}
