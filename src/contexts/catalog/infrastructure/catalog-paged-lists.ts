/** Catalog paged list queries (projects/agents/schedules/impact). */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { SQLQueryBindings } from "bun:sqlite";

import type { PageParams, PaginatedList, SortParams } from "@shared/pagination";
import { parseSortParams } from "@shared/pagination";
import type { RunState } from "@shared/run-states";

import { describeCron } from "@shared/cron-describe";
import type { Database } from "@/infrastructure/persistence/db";
import {
  createCatalogRepositories,
  mapAgent,
  mapProject,
  mapSchedule,
} from "@/contexts/catalog/infrastructure/catalog-repositories";
import type { Agent, Project, Schedule } from "@/infrastructure/persistence/types";
import {
  likePattern,
  buildWhere,
  manifestIsPresent,
  sqlOrderBy,
  OPEN_PR_COUNT_SQL,
} from "@/infrastructure/persistence/sql-paging";
import type { DashboardOverviewRun } from "@shared/dashboard";
import {
  AGENT_SORT_ALLOWED,
  IMPACT_ITEM_SORT_ALLOWED,
  PROJECT_SORT_ALLOWED,
  SCHEDULE_SORT_ALLOWED,
  type ImpactItemListRow,
  type ProjectSummaryCounts,
} from "@shared/list-api";

export type { ImpactItemListRow, ProjectSummaryCounts };

export type ListProjectsPageInput = PageParams &
  Partial<SortParams> & {
    q?: string | null;
    /** When true, only projects with currently-open gojo-tracked PRs. */
    hasOpenPrs?: boolean | null;
  };

export type ListAgentsPageInput = PageParams &
  Partial<SortParams> & {
    projectId?: string | null;
    enabled?: boolean | null;
    q?: string | null;
  };

export type ListImpactItemsPageInput = PageParams &
  Partial<SortParams> & {
    category?: string | null;
    projectId?: string | null;
    /** Inclusive ISO lower bound on run creation time. */
    from?: string | null;
    /** Inclusive ISO upper bound on run creation time. */
    to?: string | null;
  };

export type ListSchedulesPageInput = PageParams &
  Partial<SortParams> & {
    projectId?: string | null;
    agentId?: string | null;
    enabled?: boolean | null;
    q?: string | null;
  };

export type AgentSourceInfo = {
  repoPath: string;
  manifestPath: string | null;
  promptFile: string | null;
  promptAbsolutePath: string | null;
};

export type AgentListRow = Agent & {
  projectName: string | null;
  profileName: string | null;
  lastRunId: string | null;
  lastRunState: string | null;
  lastRunCreatedAt: string | null;
  /** Up to 5 recent runs, oldest → newest (same shape as dashboard overview). */
  recentRuns: DashboardOverviewRun[];
};

/** Agent detail: list enrichments + YAML/prompt provenance for ops (not an editor). */
export type AgentDetailRow = AgentListRow & {
  source: AgentSourceInfo;
};

export type ScheduleListRow = Schedule & {
  agentName: string | null;
  projectId: string | null;
  projectName: string | null;
  cronDescription: string;
};

export type ProjectListRow = Omit<Project, "manifestJson"> &
  ProjectSummaryCounts & {
    manifestJson?: undefined;
  };

/** Detail row: full project + summary counts. */
export type ProjectDetailRow = Project & ProjectSummaryCounts;

type SqlAgentRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  prompt: string;
  profile_id: string | null;
  validation_profile_json: string;
  integration_json: string;
  failure_policy_json: string;
  concurrency_json: string;
  notifications_json: string;
  environment_json: string;
  trigger_json: string;
  enabled: number;
  created_at: string;
  project_name: string | null;
  profile_name: string | null;
  last_run_id: string | null;
  last_run_state: string | null;
  last_run_created_at: string | null;
};

type SqlScheduleRow = {
  id: string;
  agent_id: string;
  name: string;
  cron_expr: string;
  timezone: string;
  enabled: number;
  overlap_policy: string;
  missed_run_policy: string;
  retry_json: string;
  consecutive_failures: number;
  disable_after: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  agent_name: string | null;
  project_id: string | null;
  project_name: string | null;
};


export function projectSummaryFor(
  db: Database,
  projectId: string,
): ProjectSummaryCounts | null {
  const sqlite = db.connection();
  const row = sqlite
    .query<
      {
        manifest_json: string;
        agent_count: number;
        enabled_agent_count: number;
        schedule_count: number;
        enabled_schedule_count: number;
        open_pr_count: number;
      },
      [string]
    >(
      `SELECT
         p.manifest_json AS manifest_json,
         (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id) AS agent_count,
         (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id AND a.enabled = 1) AS enabled_agent_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE a.project_id = p.id) AS schedule_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE a.project_id = p.id AND s.enabled = 1) AS enabled_schedule_count,
         ${OPEN_PR_COUNT_SQL} AS open_pr_count
       FROM projects p
       WHERE p.id = ?`,
    )
    .get(projectId);
  if (!row) {
    return null;
  }
  return {
    agentCount: row.agent_count,
    enabledAgentCount: row.enabled_agent_count,
    scheduleCount: row.schedule_count,
    enabledScheduleCount: row.enabled_schedule_count,
    hasManifest: manifestIsPresent(row.manifest_json),
    openPrCount: row.open_pr_count,
  };
}

export function toProjectDetailRow(
  db: Database,
  project: Project,
): ProjectDetailRow {
  const summary = projectSummaryFor(db, project.id) ?? {
    agentCount: 0,
    enabledAgentCount: 0,
    scheduleCount: 0,
    enabledScheduleCount: 0,
    hasManifest: manifestIsPresent(project.manifestJson),
    openPrCount: 0,
  };
  return { ...project, ...summary };
}

export function listProjectsPage(
  db: Database,
  input: ListProjectsPageInput,
): PaginatedList<ProjectListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  const q = input.q?.trim();
  if (q) {
    buildWhere(
      clauses,
      params,
      `(p.name LIKE ? ESCAPE '\\' OR p.repo_path LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\')`,
      likePattern(q),
    );
    params.push(likePattern(q), likePattern(q));
  }
  if (input.hasOpenPrs === true) {
    clauses.push(`${OPEN_PR_COUNT_SQL} > 0`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count FROM projects p ${where}`,
      )
      .get(...params)?.count ?? 0;

  type ProjectListSqlRow = Parameters<typeof mapProject>[0] & {
    agent_count: number;
    enabled_agent_count: number;
    schedule_count: number;
    enabled_schedule_count: number;
    open_pr_count: number;
  };

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: PROJECT_SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "asc" },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      name: "p.name COLLATE NOCASE",
      createdAt: "p.created_at",
      updatedAt: "p.updated_at",
      defaultBranch: "p.default_branch COLLATE NOCASE",
    },
    "p.id ASC",
  );

  const rows = sqlite
    .query(
      `SELECT
         p.id, p.name, p.repo_path, p.remote_url, p.default_branch,
         p.manifest_json, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id) AS agent_count,
         (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id AND a.enabled = 1) AS enabled_agent_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE a.project_id = p.id) AS schedule_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN agents a ON a.id = s.agent_id
            WHERE a.project_id = p.id AND s.enabled = 1) AS enabled_schedule_count,
         ${OPEN_PR_COUNT_SQL} AS open_pr_count
       FROM projects p
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as ProjectListSqlRow[];

  return {
    items: rows.map((row) => {
      const project = mapProject(row);
      return {
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        remoteUrl: project.remoteUrl,
        defaultBranch: project.defaultBranch,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        agentCount: row.agent_count,
        enabledAgentCount: row.enabled_agent_count,
        scheduleCount: row.schedule_count,
        enabledScheduleCount: row.enabled_schedule_count,
        hasManifest: manifestIsPresent(row.manifest_json),
        openPrCount: row.open_pr_count,
      };
    }),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}


export function listImpactItemsPage(
  db: Database,
  input: ListImpactItemsPageInput,
): PaginatedList<ImpactItemListRow> {
  const sqlite = db.connection();
  const clauses: string[] = ["ii.verification <> 'rejected'"];
  const params: SQLQueryBindings[] = [];

  if (input.category) {
    buildWhere(clauses, params, "ii.category = ?", input.category);
  }
  if (input.projectId) {
    buildWhere(clauses, params, "r.project_id = ?", input.projectId);
  }
  if (input.from) {
    buildWhere(clauses, params, "r.created_at >= ?", input.from);
  }
  if (input.to) {
    buildWhere(clauses, params, "r.created_at <= ?", input.to);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const from = `FROM run_impact_items ii
    INNER JOIN runs r ON r.id = ii.run_id
    INNER JOIN projects p ON p.id = r.project_id
    INNER JOIN agents a ON a.id = r.agent_id`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count ${from} ${where}`,
      )
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    {
      allowed: IMPACT_ITEM_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "desc",
    },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      createdAt: "ii.created_at",
      category: "ii.category",
      subject: "ii.subject COLLATE NOCASE",
      projectName: "p.name COLLATE NOCASE",
      agentName: "a.name COLLATE NOCASE",
    },
    "ii.id DESC",
  );

  type ImpactSqlRow = {
    id: string;
    run_id: string;
    project_id: string;
    project_name: string;
    agent_id: string;
    agent_name: string;
    category: string;
    subject: string;
    summary: string;
    source: string;
    verification: string;
    confidence: number | null;
    created_at: string;
  };

  const rows = sqlite
    .query<ImpactSqlRow, SQLQueryBindings[]>(
      `SELECT ii.id, ii.run_id, r.project_id, p.name AS project_name,
              r.agent_id, a.name AS agent_name,
              ii.category, ii.subject, ii.summary, ii.source, ii.verification,
              ii.confidence, ii.created_at
       ${from}
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      projectId: row.project_id,
      projectName: row.project_name,
      agentId: row.agent_id,
      agentName: row.agent_name,
      category: row.category,
      subject: row.subject,
      summary: row.summary,
      source: row.source,
      verification: row.verification,
      confidence: row.confidence,
      createdAt: row.created_at,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

export function listAgentsPage(
  db: Database,
  input: ListAgentsPageInput,
): PaginatedList<AgentListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.projectId) {
    buildWhere(clauses, params, "a.project_id = ?", input.projectId);
  }
  if (input.enabled === true) {
    buildWhere(clauses, params, "a.enabled = ?", 1);
  } else if (input.enabled === false) {
    buildWhere(clauses, params, "a.enabled = ?", 0);
  }
  const q = input.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    clauses.push(
      `(a.name LIKE ? ESCAPE '\\' OR a.id LIKE ? ESCAPE '\\' OR IFNULL(a.description,'') LIKE ? ESCAPE '\\' OR IFNULL(p.name,'') LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM agents a
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN profiles pr ON pr.id = a.profile_id
    LEFT JOIN (
      SELECT id, agent_id, state, created_at,
             ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC) AS rn
      FROM runs
    ) lr ON lr.agent_id = a.id AND lr.rn = 1
    LEFT JOIN (
      SELECT agent_id,
             CAST(SUM(CASE WHEN state = 'Succeeded' THEN 1 ELSE 0 END) AS REAL)
               / COUNT(*) AS success_rate
      FROM (
        SELECT agent_id, state,
               ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC) AS rn
        FROM runs
      )
      WHERE rn <= 5
      GROUP BY agent_id
    ) sr ON sr.agent_id = a.id`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count FROM agents a
         LEFT JOIN projects p ON p.id = a.project_id
         ${where}`,
      )
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: AGENT_SORT_ALLOWED, defaultSort: "name", defaultOrder: "asc" },
  );
  const orderBy =
    sort === "successRate"
      ? // Nulls (no runs) last in both directions — ops triage cares about agents with history.
        `ORDER BY (sr.success_rate IS NULL) ASC, sr.success_rate ${
          order === "asc" ? "ASC" : "DESC"
        }, a.id ASC`
      : sqlOrderBy(
          sort,
          order,
          {
            name: "a.name COLLATE NOCASE",
            projectName: "IFNULL(p.name, '') COLLATE NOCASE",
            enabled: "a.enabled",
            createdAt: "a.created_at",
            lastRunAt: "lr.created_at",
          },
          "a.id ASC",
        );

  const rows = sqlite
    .query<SqlAgentRow, SQLQueryBindings[]>(
      `SELECT a.*, p.name AS project_name, pr.name AS profile_name,
              lr.id AS last_run_id, lr.state AS last_run_state, lr.created_at AS last_run_created_at
       ${from} ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  const recentByAgent = loadRecentRunsForAgents(
    db,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => ({
      ...mapAgent({ ...row, description: row.description ?? "" }),
      projectName: row.project_name,
      profileName: row.profile_name,
      lastRunId: row.last_run_id,
      lastRunState: row.last_run_state,
      lastRunCreatedAt: row.last_run_created_at,
      recentRuns: recentByAgent.get(row.id) ?? [],
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

function resolveAgentSource(project: Project, agentName: string): AgentSourceInfo {
  const repoPath = project.repoPath;
  const gojoYaml = join(repoPath, "gojo.yaml");
  const legacyYaml = join(repoPath, ".gojo", "project.yaml");
  const onDisk =
    (existsSync(gojoYaml) ? gojoYaml : null) ?? (existsSync(legacyYaml) ? legacyYaml : null);

  let promptFile: string | null = null;
  let inSyncedManifest = false;
  try {
    const parsed = JSON.parse(project.manifestJson) as {
      agents?: Record<string, { promptFile?: unknown }>;
    };
    const entry = parsed.agents?.[agentName];
    if (entry) {
      inSyncedManifest = true;
      if (typeof entry.promptFile === "string" && entry.promptFile.trim()) {
        promptFile = entry.promptFile.trim();
      }
    }
  } catch {
    // Stored manifest may be empty or non-JSON; treat as no source.
  }

  const manifestPath = onDisk ?? (inSyncedManifest ? gojoYaml : null);
  const promptAbsolutePath = promptFile ? join(repoPath, promptFile) : null;

  return {
    repoPath,
    manifestPath,
    promptFile,
    promptAbsolutePath,
  };
}

/** Single-agent detail for ops inspect (enriched row + YAML/prompt paths). */

export function getAgentDetail(db: Database, agentId: string): AgentDetailRow | null {
  const repos = createCatalogRepositories(db);
  const agent = repos.agents.findById(agentId);
  if (!agent) {
    return null;
  }

  const project = repos.projects.findById(agent.projectId);
  const profile = agent.profileId ? repos.profiles.findById(agent.profileId) : null;
  const recentRuns = loadRecentRunsForAgents(db, [agent.id]).get(agent.id) ?? [];
  const last = recentRuns.at(-1) ?? null;

  return {
    ...agent,
    projectName: project?.name ?? null,
    profileName: profile?.name ?? null,
    lastRunId: last?.id ?? null,
    lastRunState: last?.state ?? null,
    lastRunCreatedAt: last?.createdAt ?? null,
    recentRuns,
    source: project
      ? resolveAgentSource(project, agent.name)
      : {
          repoPath: "",
          manifestPath: null,
          promptFile: null,
          promptAbsolutePath: null,
        },
  };
}

type RecentRunRow = {
  id: string;
  agent_id: string;
  state: string;
  trigger: string;
  created_at: string;
  finished_at: string | null;
  rn: number;
};

/** Last 5 runs per agent (oldest → newest), scoped to the given agent ids. */
function loadRecentRunsForAgents(
  db: Database,
  agentIds: string[],
): Map<string, DashboardOverviewRun[]> {
  const byAgent = new Map<string, DashboardOverviewRun[]>();
  if (agentIds.length === 0) {
    return byAgent;
  }

  const placeholders = agentIds.map(() => "?").join(", ");
  const rows = db
    .connection()
    .query<RecentRunRow, SQLQueryBindings[]>(
      `SELECT id, agent_id, state, trigger, created_at, finished_at, rn
       FROM (
         SELECT id, agent_id, state, trigger, created_at, finished_at,
                ROW_NUMBER() OVER (
                  PARTITION BY agent_id ORDER BY created_at DESC
                ) AS rn
         FROM runs
         WHERE agent_id IN (${placeholders})
       )
       WHERE rn <= 5
       ORDER BY agent_id, rn DESC`,
    )
    .all(...agentIds);

  for (const row of rows) {
    const list = byAgent.get(row.agent_id) ?? [];
    list.push({
      id: row.id,
      state: row.state as RunState,
      trigger: row.trigger,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    });
    byAgent.set(row.agent_id, list);
  }

  return byAgent;
}


export function listSchedulesPage(
  db: Database,
  input: ListSchedulesPageInput,
): PaginatedList<ScheduleListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.projectId) {
    buildWhere(clauses, params, "a.project_id = ?", input.projectId);
  }
  if (input.agentId) {
    buildWhere(clauses, params, "s.agent_id = ?", input.agentId);
  }
  if (input.enabled === true) {
    buildWhere(clauses, params, "s.enabled = ?", 1);
  } else if (input.enabled === false) {
    buildWhere(clauses, params, "s.enabled = ?", 0);
  }
  const q = input.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    clauses.push(
      `(s.name LIKE ? ESCAPE '\\' OR s.id LIKE ? ESCAPE '\\' OR IFNULL(a.name,'') LIKE ? ESCAPE '\\' OR IFNULL(p.name,'') LIKE ? ESCAPE '\\' OR s.cron_expr LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM schedules s
    LEFT JOIN agents a ON a.id = s.agent_id
    LEFT JOIN projects p ON p.id = a.project_id`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS count ${from} ${where}`)
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: SCHEDULE_SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "asc" },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      name: "s.name COLLATE NOCASE",
      projectName: "IFNULL(p.name, '') COLLATE NOCASE",
      cronExpr: "s.cron_expr",
      nextRunAt: "s.next_run_at",
      lastRunAt: "s.last_run_at",
      enabled: "s.enabled",
      createdAt: "s.created_at",
    },
    "s.id ASC",
  );

  const rows = sqlite
    .query<SqlScheduleRow, SQLQueryBindings[]>(
      `SELECT s.*, a.name AS agent_name, a.project_id AS project_id, p.name AS project_name
       ${from} ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => {
      const schedule = mapSchedule(row);
      return {
        ...schedule,
        agentName: row.agent_name,
        projectId: row.project_id,
        projectName: row.project_name,
        cronDescription: describeCron(schedule.cronExpr),
      };
    }),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

