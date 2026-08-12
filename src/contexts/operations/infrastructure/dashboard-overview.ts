import type {
  DashboardOverview,
  DashboardOverviewAgent,
  DashboardOverviewProject,
  DashboardOverviewRun,
} from "@shared/dashboard";
import type { RunState } from "@shared/run-states";

import type { Database } from "@/infrastructure/persistence";

export type {
  DashboardOverview,
  DashboardOverviewAgent,
  DashboardOverviewProject,
  DashboardOverviewRun,
};

type ProjectRow = { id: string; name: string; enabled: number };
type AgentRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
};
type RunRow = {
  id: string;
  agent_id: string;
  state: string;
  trigger: string;
  created_at: string;
  finished_at: string | null;
  rn: number;
};

/**
 * Projects (name order) with enabled agents and up to 5 recent runs each.
 * `recentRuns` is oldest → newest (newest last) for left-to-right UI strips.
 */
export function getDashboardOverview(db: Database): DashboardOverview {
  const sqlite = db.connection();

  const projects = sqlite
    .query<ProjectRow, []>(
      "SELECT id, name, enabled FROM projects ORDER BY name COLLATE NOCASE",
    )
    .all();

  if (projects.length === 0) {
    return { projects: [] };
  }

  const agents = sqlite
    .query<AgentRow, []>(
      `SELECT id, project_id, name, description
       FROM agents
       WHERE enabled = 1
       ORDER BY name COLLATE NOCASE`,
    )
    .all();

  const runs = sqlite
    .query<RunRow, []>(
      `SELECT id, agent_id, state, trigger, created_at, finished_at, rn
       FROM (
         SELECT id, agent_id, state, trigger, created_at, finished_at,
                ROW_NUMBER() OVER (
                  PARTITION BY agent_id ORDER BY created_at DESC
                ) AS rn
         FROM runs
       )
       WHERE rn <= 5
       ORDER BY agent_id, rn DESC`,
    )
    .all();

  const runsByAgent = new Map<string, DashboardOverviewRun[]>();
  for (const row of runs) {
    const list = runsByAgent.get(row.agent_id) ?? [];
    list.push({
      id: row.id,
      state: row.state as RunState,
      trigger: row.trigger,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    });
    runsByAgent.set(row.agent_id, list);
  }

  const agentsByProject = new Map<string, DashboardOverviewAgent[]>();
  for (const agent of agents) {
    const list = agentsByProject.get(agent.project_id) ?? [];
    list.push({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? "",
      recentRuns: runsByAgent.get(agent.id) ?? [],
    });
    agentsByProject.set(agent.project_id, list);
  }

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      enabled: project.enabled === 1,
      agents: agentsByProject.get(project.id) ?? [],
    })),
  };
}
