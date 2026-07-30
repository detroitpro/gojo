import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { computeScheduleNextRun } from "@/app/context";
import { parseProjectManifest } from "@shared/manifest";
import type { Repositories } from "@/storage";
import type { Project } from "@/storage/types";

export interface ProjectSyncResult {
  manifestPath: string | null;
  profiles: number;
  agents: number;
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
      profiles: 0,
      agents: 0,
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

  const profileIds = new Map<string, string>();
  let profiles = 0;

  for (const [name, config] of Object.entries(manifest.profiles)) {
    const profile = repos.profiles.create({
      projectId: project.id,
      name,
      adapter: config.adapter,
      configJson: JSON.stringify(config),
    });
    profileIds.set(name, profile.id);
    profiles += 1;
  }

  const agentIds = new Map<string, string>();
  let agents = 0;

  for (const [name, agentConfig] of Object.entries(manifest.agents)) {
    const profileId = profileIds.get(agentConfig.profile) ?? null;
    const validationProfile = manifest.validationProfiles[agentConfig.validationProfile];
    const prompt = readPrompt(project.repoPath, agentConfig.promptFile);

    const existing = repos.agents
      .listByProject(project.id)
      .find((agent) => agent.name === name);

    const failurePolicyJson = JSON.stringify({
      ...(agentConfig.failurePolicy ?? {}),
      ...(agentConfig.selfHeal ? { selfHeal: agentConfig.selfHeal } : {}),
    });

    if (existing) {
      repos.agents.update(existing.id, {
        description: agentConfig.description,
        profileId,
        prompt,
        validationProfileJson: JSON.stringify(validationProfile ?? { steps: [] }),
        integrationJson: JSON.stringify(agentConfig.integration ?? {}),
        failurePolicyJson,
        concurrencyJson: JSON.stringify(agentConfig.concurrency ?? {}),
        notificationsJson: JSON.stringify(agentConfig.notifications ?? {}),
      });
      agentIds.set(name, existing.id);
    } else {
      const created = repos.agents.create({
        projectId: project.id,
        name,
        description: agentConfig.description,
        profileId,
        prompt,
        validationProfileJson: JSON.stringify(validationProfile ?? { steps: [] }),
        integrationJson: JSON.stringify(agentConfig.integration ?? {}),
        failurePolicyJson,
        concurrencyJson: JSON.stringify(agentConfig.concurrency ?? {}),
        notificationsJson: JSON.stringify(agentConfig.notifications ?? {}),
      });
      agentIds.set(name, created.id);
    }
    agents += 1;
  }

  // Disable agents removed from the manifest so they stop appearing as runnable.
  for (const existing of repos.agents.listByProject(project.id)) {
    if (!agentIds.has(existing.name) && existing.enabled) {
      repos.agents.update(existing.id, { enabled: false });
    }
  }

  const desiredSchedules = new Set<string>();
  let schedules = 0;
  if (manifest.schedules) {
    for (const [name, scheduleConfig] of Object.entries(manifest.schedules)) {
      const agentId = agentIds.get(scheduleConfig.agent);
      if (!agentId) {
        continue;
      }

      const agentConfig = manifest.agents[scheduleConfig.agent];
      const disableAfter =
        agentConfig?.failurePolicy?.disableAfterConsecutiveFailedRuns ?? null;

      const nextRunAt = computeScheduleNextRun(scheduleConfig.cron, scheduleConfig.timezone);
      const existing = repos.schedules
        .listByAgent(agentId)
        .find((item) => item.name === name);

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
          agentId,
          name,
          cronExpr: scheduleConfig.cron,
          timezone: scheduleConfig.timezone,
          enabled: true,
          nextRunAt,
          disableAfter,
        });
      }
      desiredSchedules.add(`${agentId}:${name}`);
      schedules += 1;
    }
  }

  // Soft-disable schedules removed/renamed in the manifest (mirror agents).
  for (const agent of repos.agents.listByProject(project.id)) {
    for (const schedule of repos.schedules.listByAgent(agent.id)) {
      if (schedule.enabled && !desiredSchedules.has(`${schedule.agentId}:${schedule.name}`)) {
        repos.schedules.update(schedule.id, { enabled: false });
      }
    }
  }

  return {
    manifestPath,
    profiles,
    agents,
    schedules,
  };
}
