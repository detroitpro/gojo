import type { RunState } from "@shared/run-states";

import type { Database } from "@/storage";

export type DashboardOverviewRun = {
  id: string;
  state: RunState;
  trigger: string;
  createdAt: string;
  finishedAt: string | null;
};

export type DashboardOverviewTask = {
  id: string;
  name: string;
  description: string;
  recentRuns: DashboardOverviewRun[];
};

export type DashboardOverviewProject = {
  id: string;
  name: string;
  tasks: DashboardOverviewTask[];
};

export type DashboardOverview = {
  projects: DashboardOverviewProject[];
};

type ProjectRow = { id: string; name: string };
type TaskRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
};
type RunRow = {
  id: string;
  task_id: string;
  state: string;
  trigger: string;
  created_at: string;
  finished_at: string | null;
  rn: number;
};

/**
 * Projects (name order) with enabled tasks and up to 5 recent runs each.
 * `recentRuns` is oldest → newest (newest last) for left-to-right UI strips.
 */
export function getDashboardOverview(db: Database): DashboardOverview {
  const sqlite = db.connection();

  const projects = sqlite
    .query<ProjectRow, []>("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE")
    .all();

  if (projects.length === 0) {
    return { projects: [] };
  }

  const tasks = sqlite
    .query<TaskRow, []>(
      `SELECT id, project_id, name, description
       FROM tasks
       WHERE enabled = 1
       ORDER BY name COLLATE NOCASE`,
    )
    .all();

  const runs = sqlite
    .query<RunRow, []>(
      `SELECT id, task_id, state, trigger, created_at, finished_at, rn
       FROM (
         SELECT id, task_id, state, trigger, created_at, finished_at,
                ROW_NUMBER() OVER (
                  PARTITION BY task_id ORDER BY created_at DESC
                ) AS rn
         FROM runs
       )
       WHERE rn <= 5
       ORDER BY task_id, rn DESC`,
    )
    .all();

  const runsByTask = new Map<string, DashboardOverviewRun[]>();
  for (const row of runs) {
    const list = runsByTask.get(row.task_id) ?? [];
    list.push({
      id: row.id,
      state: row.state as RunState,
      trigger: row.trigger,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    });
    runsByTask.set(row.task_id, list);
  }

  const tasksByProject = new Map<string, DashboardOverviewTask[]>();
  for (const task of tasks) {
    const list = tasksByProject.get(task.project_id) ?? [];
    list.push({
      id: task.id,
      name: task.name,
      description: task.description ?? "",
      recentRuns: runsByTask.get(task.id) ?? [],
    });
    tasksByProject.set(task.project_id, list);
  }

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      tasks: tasksByProject.get(project.id) ?? [],
    })),
  };
}
