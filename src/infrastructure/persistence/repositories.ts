/**
 * Transitional aggregated repository types.
 * Implementations live under contexts/<name>/infrastructure.
 * Factory: @/platform/create-repositories
 */
import type {
  Agent,
  Attempt,
  AuditEvent,
  Profile,
  CreateAgentInput,
  CreateAttemptInput,
  CreateAuditEventInput,
  CreateProfileInput,
  CreateProjectInput,
  CreateRunInput,
  CreateScheduleInput,
  Project,
  Run,
  RunImpactItem,
  RunImpactItemDraft,
  RunIntegration,
  Schedule,
  SecretRecord,
  UpdateAgentInput,
  UpdateAttemptInput,
  UpdateProjectInput,
  UpdateRunInput,
  UpdateRunIntegrationInput,
  UpdateScheduleInput,
  UpsertRunIntegrationInput,
  UpsertSecretInput,
} from "./types";

export interface ProjectRepository {
  create(input: CreateProjectInput): Project;
  findById(id: string): Project | null;
  list(): Project[];
  update(id: string, input: UpdateProjectInput): Project | null;
  delete(id: string): boolean;
}

export interface AgentRepository {
  create(input: CreateAgentInput): Agent;
  findById(id: string): Agent | null;
  findEnabledByProjectAndName(projectId: string, name: string): Agent | null;
  listByProject(projectId: string): Agent[];
  listAll(): Agent[];
  count(): number;
  update(id: string, input: UpdateAgentInput): Agent | null;
  delete(id: string): boolean;
}

export interface ScheduleRepository {
  create(input: CreateScheduleInput): Schedule;
  findById(id: string): Schedule | null;
  listByAgent(agentId: string): Schedule[];
  listDue(nowIso: string): Schedule[];
  count(): number;
  update(id: string, input: UpdateScheduleInput): Schedule | null;
  updateNextRun(
    id: string,
    nextRunAt: string | null,
    lastRunAt?: string | null,
  ): Schedule | null;
  incrementFailures(id: string): number;
  resetFailures(id: string): void;
  disable(id: string): boolean;
  delete(id: string): boolean;
}

export interface RunRepository {
  create(input: CreateRunInput): Run;
  findById(id: string): Run | null;
  findByIdempotencyKey(key: string): Run | null;
  listByProject(projectId: string): Run[];
  listAll(): Run[];
  count(): number;
  listNonTerminal(): Run[];
  listQueued(): Run[];
  countRunningByProject(): Record<string, number>;
  latestAdmittedAt(): string | null;
  countConsecutiveFailuresForAgent(agentId: string, lookback: number): number;
  countByProjectTriggerSince(
    projectId: string,
    trigger: Run["trigger"],
    since: string,
  ): number;
  countActiveBySchedule(scheduleId: string): number;
  countQueuedBySchedule(scheduleId: string): number;
  update(id: string, input: UpdateRunInput): Run | null;
  delete(id: string): boolean;
}

export interface ProfileRepository {
  create(input: CreateProfileInput): Profile;
  findById(id: string): Profile | null;
}

export interface AttemptRepository {
  create(input: CreateAttemptInput): Attempt;
  findById(id: string): Attempt | null;
  listByRun(runId: string): Attempt[];
  update(id: string, input: UpdateAttemptInput): Attempt | null;
  delete(id: string): boolean;
}

export interface AuditRepository {
  create(input: CreateAuditEventInput): AuditEvent;
  findById(id: string): AuditEvent | null;
  listByTarget(target: string, limit?: number): AuditEvent[];
}

export interface SecretRepository {
  upsert(input: UpsertSecretInput): SecretRecord;
  findByName(name: string, projectId?: string | null): SecretRecord | null;
  deleteByName(name: string, projectId?: string | null): boolean;
  list(): SecretRecord[];
}

export interface RunImpactItemRepository {
  replaceForRun(
    runId: string,
    attemptId: string | null,
    items: RunImpactItemDraft[],
  ): RunImpactItem[];
  listByRun(runId: string): RunImpactItem[];
}

export interface RunIntegrationRepository {
  upsertForRun(input: UpsertRunIntegrationInput): RunIntegration;
  findByRun(runId: string): RunIntegration | null;
  listDue(nowIso: string, limit: number): RunIntegration[];
  update(id: string, input: UpdateRunIntegrationInput): RunIntegration | null;
}

/** @removal(when: AppContext holds typed per-context ports): dissolve Repositories bag — S1 */
export interface Repositories {
  projects: ProjectRepository;
  agents: AgentRepository;
  schedules: ScheduleRepository;
  runs: RunRepository;
  attempts: AttemptRepository;
  audit: AuditRepository;
  secrets: SecretRepository;
  profiles: ProfileRepository;
  runImpactItems: RunImpactItemRepository;
  runIntegrations: RunIntegrationRepository;
}
