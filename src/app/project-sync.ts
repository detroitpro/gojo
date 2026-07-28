import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { computeScheduleNextRun } from "@/app/context";
import { parseProjectManifest } from "@shared/manifest";
import type { Repositories } from "@/storage";
import type { Project } from "@/storage/types";

export interface ProjectSyncResult {
  manifestPath: string | null;
  agentProfiles: number;
  tasks: number;
  schedules: number;
}

function resolveManifestPath(repoPath: string): string | null {
  const candidates = [
    join(repoPath, "gojo.yaml"),
    join(repoPath, ".gojo", "project.yaml"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readPrompt(repoPath: string, promptFile: string): string {
  const path = join(repoPath, promptFile);
  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${promptFile}`);
  }
  return readFileSync(path, "utf8");
}

export function syncProjectFromManifest(
  repos: Repositories,
  project: Project,
): ProjectSyncResult {
  const manifestPath = resolveManifestPath(project.repoPath);
  if (!manifestPath) {
    return {
      manifestPath: null,
      agentProfiles: 0,
      tasks: 0,
      schedules: 0,
    };
  }

  const raw = parseYaml(readFileSync(manifestPath, "utf8")) as unknown;
  const manifest = parseProjectManifest(raw);

  repos.projects.update(project.id, {
    manifestJson: JSON.stringify(manifest),
    defaultBranch: manifest.project.defaultBranch,
    name: manifest.project.name,
  });

  const agentProfileIds = new Map<string, string>();
  let agentProfiles = 0;

  for (const [name, config] of Object.entries(manifest.agents)) {
    const profile = repos.agentProfiles.create({
      projectId: project.id,
      name,
      adapter: config.adapter,
      configJson: JSON.stringify(config),
    });
    agentProfileIds.set(name, profile.id);
    agentProfiles += 1;
  }

  const taskIds = new Map<string, string>();
  let tasks = 0;

  for (const [name, taskConfig] of Object.entries(manifest.tasks)) {
    const agentProfileId = agentProfileIds.get(taskConfig.agent) ?? null;
    const validationProfile = manifest.validationProfiles[taskConfig.validationProfile];
    const prompt = readPrompt(project.repoPath, taskConfig.promptFile);

    const existing = repos.tasks
      .listByProject(project.id)
      .find((task) => task.name === name);

    const failurePolicyJson = JSON.stringify({
      ...(taskConfig.failurePolicy ?? {}),
      ...(taskConfig.selfHeal ? { selfHeal: taskConfig.selfHeal } : {}),
    });

    if (existing) {
      repos.tasks.update(existing.id, {
        description: taskConfig.description,
        agentProfileId,
        prompt,
        validationProfileJson: JSON.stringify(validationProfile ?? { steps: [] }),
        integrationJson: JSON.stringify(taskConfig.integration ?? {}),
        failurePolicyJson,
        concurrencyJson: JSON.stringify(taskConfig.concurrency ?? {}),
        notificationsJson: JSON.stringify(taskConfig.notifications ?? {}),
      });
      taskIds.set(name, existing.id);
    } else {
      const created = repos.tasks.create({
        projectId: project.id,
        name,
        description: taskConfig.description,
        agentProfileId,
        prompt,
        validationProfileJson: JSON.stringify(validationProfile ?? { steps: [] }),
        integrationJson: JSON.stringify(taskConfig.integration ?? {}),
        failurePolicyJson,
        concurrencyJson: JSON.stringify(taskConfig.concurrency ?? {}),
        notificationsJson: JSON.stringify(taskConfig.notifications ?? {}),
      });
      taskIds.set(name, created.id);
    }
    tasks += 1;
  }

  // Disable tasks removed from the manifest so they stop appearing as runnable.
  for (const existing of repos.tasks.listByProject(project.id)) {
    if (!taskIds.has(existing.name) && existing.enabled) {
      repos.tasks.update(existing.id, { enabled: false });
    }
  }

  const desiredSchedules = new Set<string>();
  let schedules = 0;
  if (manifest.schedules) {
    for (const [name, scheduleConfig] of Object.entries(manifest.schedules)) {
      const taskId = taskIds.get(scheduleConfig.task);
      if (!taskId) {
        continue;
      }

      const taskConfig = manifest.tasks[scheduleConfig.task];
      const disableAfter =
        taskConfig?.failurePolicy?.disableAfterConsecutiveFailedRuns ?? null;

      const nextRunAt = computeScheduleNextRun(scheduleConfig.cron, scheduleConfig.timezone);
      const existing = repos.schedules.listByTask(taskId).find((item) => item.name === name);

      if (existing) {
        repos.schedules.update(existing.id, {
          cronExpr: scheduleConfig.cron,
          timezone: scheduleConfig.timezone,
          enabled: true,
          nextRunAt,
          disableAfter,
        });
      } else {
        repos.schedules.create({
          taskId,
          name,
          cronExpr: scheduleConfig.cron,
          timezone: scheduleConfig.timezone,
          enabled: true,
          nextRunAt,
          disableAfter,
        });
      }
      desiredSchedules.add(`${taskId}:${name}`);
      schedules += 1;
    }
  }

  // Soft-disable schedules removed/renamed in the manifest (mirror tasks).
  for (const task of repos.tasks.listByProject(project.id)) {
    for (const schedule of repos.schedules.listByTask(task.id)) {
      if (schedule.enabled && !desiredSchedules.has(`${schedule.taskId}:${schedule.name}`)) {
        repos.schedules.update(schedule.id, { enabled: false });
      }
    }
  }

  return {
    manifestPath,
    agentProfiles,
    tasks,
    schedules,
  };
}
