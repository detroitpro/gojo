import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ulid } from 'ulid';

import { getAdapter } from '@/agents';
import type { AgentExecuteResult } from '@/agents/adapter/types';
import type { GojoPaths } from '@/config/paths';
import { diffNameOnly, execGit } from '@/git/git';
import { integrate, type IntegrationMode } from '@/integration/integrator';
import { MergeQueue } from '@/integration/queue';
import { canTransition, isTerminal, RunState } from '@shared/run-states';
import type { AgentHandoffReport } from '@shared/handoff';
import type { Database } from '@/storage/db';
import { createRepositories } from '@/storage/repositories';
import type { Attempt, Project, Run, Task } from '@/storage/types';
import { runValidationProfile, type ValidationStepResult } from '@/validation/engine';
import { WorkspaceManager } from '@/workspace/manager';

import { RunEventBus } from './events';

const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

interface ValidationProfileConfig {
  steps?: Array<{ name: string; command: string; timeout?: string }>;
}

interface IntegrationConfig {
  mode?: IntegrationMode;
  targetBranch?: string;
  commitMessage?: string;
  postApprovalMode?: IntegrationMode;
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
  trigger: 'manual' | 'schedule' | 'api';
  idempotencyKey?: string;
}

export class RunCoordinator {
  private readonly paths: GojoPaths;
  private readonly workspace: WorkspaceManager;
  private readonly eventBus: RunEventBus;
  private readonly mergeQueue = new MergeQueue();
  private readonly repos;
  private readonly activeRuns = new Map<string, ActiveRunContext>();

  constructor(deps: {
    db: Database;
    paths: GojoPaths;
    workspace: WorkspaceManager;
    eventBus?: RunEventBus;
  }) {
    this.paths = deps.paths;
    this.workspace = deps.workspace;
    this.eventBus = deps.eventBus ?? new RunEventBus();
    this.repos = createRepositories(deps.db);
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
      run = await this.transitionRun(run, RunState.Preparing);
      if (!run.startedAt) {
        run =
          this.repos.runs.update(run.id, { startedAt: new Date().toISOString() }) ?? run;
      }

      const project = this.repos.projects.findById(run.projectId);
      const task = this.repos.tasks.findById(run.taskId);
      if (!project || !task) {
        return this.failRun(run, 'Project or task not found');
      }

      const integration = parseIntegrationConfig(task.integrationJson);
      const validation = parseValidationConfig(task.validationProfileJson);

      const workspace = await this.workspace.prepareAttempt({
        repoPath: project.repoPath,
        baseBranch: integration.targetBranch ?? project.defaultBranch,
        runId: run.id,
        taskName: task.name,
      });

      context.workspacePath = workspace.worktreePath;
      context.branchName = workspace.branchName;

      const attemptNumber =
        this.repos.attempts.listByRun(run.id).length + 1;
      let attempt = this.repos.attempts.create({
        runId: run.id,
        attemptNumber,
        workspacePath: workspace.worktreePath,
        branchName: workspace.branchName,
        startingCommit: workspace.startingCommit,
        state: 'pending',
      });

      run = await this.transitionRun(run, RunState.Running);
      attempt =
        this.repos.attempts.update(attempt.id, {
          state: 'running',
          startedAt: new Date().toISOString(),
        }) ?? attempt;

      const agentResult = await this.executeAgent(
        task,
        workspace.worktreePath,
        controller.signal,
      );

      if (controller.signal.aborted || agentResult.canceled) {
        attempt = this.finishAttempt(attempt, 'canceled', agentResult);
        await this.cleanupWorkspace(workspace.worktreePath, workspace.branchName, false);
        return this.terminalRun(run, RunState.Canceled);
      }

      if (agentResult.timedOut) {
        attempt = this.finishAttempt(attempt, 'timed_out', agentResult);
        await this.cleanupWorkspace(workspace.worktreePath, workspace.branchName, false);
        return this.terminalRun(run, RunState.TimedOut);
      }

      if (agentResult.exitCode !== 0) {
        attempt = this.finishAttempt(attempt, 'failed', agentResult);
        await this.cleanupWorkspace(workspace.worktreePath, workspace.branchName, false);
        return this.failRun(run, `Agent exited with code ${agentResult.exitCode}`);
      }

      attempt = this.finishAttempt(attempt, 'succeeded', agentResult);

      run = await this.transitionRun(run, RunState.Validating);
      const runIdForValidation = run.id;
      const validationResult = await runValidationProfile({
        cwd: workspace.worktreePath,
        steps: validation.steps ?? [],
        signal: controller.signal,
        onStep: (step) => {
          this.emit('run.validation.step', runIdForValidation, step);
        },
      });

      if (!validationResult.passed) {
        await this.cleanupWorkspace(workspace.worktreePath, workspace.branchName, false);
        return this.failRun(run, 'Validation failed');
      }

      const mode = integration.mode ?? 'none';

      if (mode === 'await-approval') {
        const commitResult = await integrate({
          mode: 'await-approval',
          projectId: project.id,
          worktreePath: workspace.worktreePath,
          repoPath: project.repoPath,
          targetBranch: integration.targetBranch ?? project.defaultBranch,
          branchName: workspace.branchName,
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
        await this.writeHandoffArtifact(run, attempt, project, task, validationResult.results);
        await this.cleanupWorkspace(workspace.worktreePath, workspace.branchName, true);
        return this.terminalRun(run, RunState.Succeeded);
      }

      return this.integrateAndFinish({
        run,
        attempt,
        project,
        task,
        integration,
        validationResults: validationResult.results,
        workspacePath: workspace.worktreePath,
        branchName: workspace.branchName,
        mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = this.repos.runs.findById(runId);
      if (current && !isTerminal(current.state)) {
        return this.failRun(current, message);
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

    const result = await integrate({
      mode: input.mode,
      projectId: input.project.id,
      worktreePath: input.workspacePath,
      repoPath: input.project.repoPath,
      targetBranch: input.integration.targetBranch ?? input.project.defaultBranch,
      branchName: input.branchName,
      commitMessage: buildCommitMessage(input.task, run, input.integration),
      runId: run.id,
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
    task: Task,
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<AgentExecuteResult> {
    const adapterName = resolveAdapterName(task, this.repos.agentProfiles);
    const adapter = getAdapter(adapterName);
    if (!adapter) {
      throw new Error(`Unknown agent adapter: ${adapterName}`);
    }

    return adapter.execute({
      workspacePath,
      prompt: task.prompt,
      env: {
        GOJO_TASK_ID: task.id,
        GOJO_PROJECT_ID: task.projectId,
      },
      timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
      signal,
    });
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
    const updated =
      this.repos.runs.update(run.id, {
        state,
        finishedAt: new Date().toISOString(),
      }) ?? run;

    this.emit('run.finished', updated.id, { state: updated.state });
    return updated;
  }

  private failRun(run: Run, message: string): Run {
    const updated =
      this.repos.runs.update(run.id, {
        state: RunState.Failed,
        finishedAt: new Date().toISOString(),
        errorMessage: message,
      }) ?? run;

    this.emit('run.failed', updated.id, { error: message });
    return updated;
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
    return (
      this.repos.attempts.update(attempt.id, {
        state,
        exitCode: result.exitCode,
        finishedAt: new Date().toISOString(),
        ...(result.handoff !== undefined
          ? { handoffJson: JSON.stringify(result.handoff) }
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

    const handoff: AgentHandoffReport = {
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
