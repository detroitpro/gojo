export type ManifestProfileView = {
  name: string;
  adapter: string;
  timeout?: string;
  model?: string;
};

export type ManifestAgentView = {
  name: string;
  description: string;
  profile: string;
  integrationMode: string;
};

export type ManifestScheduleView = {
  name: string;
  agent: string;
  cron: string;
  timezone: string;
};

export type ManifestValidationProfileView = {
  name: string;
  stepCount: number;
};

export type ParsedManifestView = {
  ok: boolean;
  error?: string;
  projectName?: string;
  defaultBranch?: string;
  repository: Record<string, unknown>;
  profiles: ManifestProfileView[];
  agents: ManifestAgentView[];
  schedules: ManifestScheduleView[];
  validationProfiles: ManifestValidationProfileView[];
  prettyJson: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseManifestView(manifestJson: string | undefined | null): ParsedManifestView {
  const raw = (manifestJson ?? "").trim() || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
      repository: {},
      profiles: [],
      agents: [],
      schedules: [],
      validationProfiles: [],
      prettyJson: raw,
    };
  }

  const root = asRecord(parsed) ?? {};
  const project = asRecord(root.project) ?? {};
  const repository = asRecord(root.repository) ?? {};
  const profilesRaw = asRecord(root.profiles) ?? {};
  const agentsRaw = asRecord(root.agents) ?? {};
  const schedulesRaw = asRecord(root.schedules) ?? {};
  const validationProfilesRaw = asRecord(root.validationProfiles) ?? {};

  const profiles: ManifestProfileView[] = Object.entries(profilesRaw).map(([name, value]) => {
    const cfg = asRecord(value) ?? {};
    return {
      name,
      adapter: typeof cfg.adapter === "string" ? cfg.adapter : "—",
      ...(typeof cfg.timeout === "string" ? { timeout: cfg.timeout } : {}),
      ...(typeof cfg.model === "string" ? { model: cfg.model } : {}),
    };
  });

  const agents: ManifestAgentView[] = Object.entries(agentsRaw).map(([name, value]) => {
    const cfg = asRecord(value) ?? {};
    const integration = asRecord(cfg.integration) ?? {};
    return {
      name,
      description: typeof cfg.description === "string" ? cfg.description : "",
      profile: typeof cfg.profile === "string" ? cfg.profile : "—",
      integrationMode:
        typeof integration.mode === "string" ? integration.mode : "—",
    };
  });

  const schedules: ManifestScheduleView[] = Object.entries(schedulesRaw).map(
    ([name, value]) => {
      const cfg = asRecord(value) ?? {};
      return {
        name,
        agent: typeof cfg.agent === "string" ? cfg.agent : "—",
        cron: typeof cfg.cron === "string" ? cfg.cron : "—",
        timezone: typeof cfg.timezone === "string" ? cfg.timezone : "—",
      };
    },
  );

  const validationProfiles: ManifestValidationProfileView[] = Object.entries(
    validationProfilesRaw,
  ).map(([name, value]) => {
    const cfg = asRecord(value) ?? {};
    const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
    return { name, stepCount: steps.length };
  });

  let prettyJson = raw;
  try {
    prettyJson = JSON.stringify(parsed, null, 2);
  } catch {
    // keep raw
  }

  return {
    ok: true,
    ...(typeof project.name === "string" ? { projectName: project.name } : {}),
    ...(typeof project.defaultBranch === "string"
      ? { defaultBranch: project.defaultBranch }
      : {}),
    repository,
    profiles,
    agents,
    schedules,
    validationProfiles,
    prettyJson,
  };
}

export type ProjectHealthLevel = "ok" | "warn" | "missing";

export type ProjectHealthSummary = {
  score: number | null;
  level: ProjectHealthLevel;
  label: string;
};

export type ProjectDoctorHealthInput = {
  repoExists: boolean;
  manifest: boolean;
  baseCheckout: {
    clean: boolean;
    dirtyFiles?: string[];
    behindOrigin?: number | null;
  };
  validationTools: Array<{ found: boolean; binary?: string; agent?: string; step?: string }>;
};

export type ProjectHealthFactor = {
  id: string;
  label: string;
  ok: boolean;
  /** Points deducted from 100 when not ok; 0 when ok or unscored. */
  penalty: number;
  /** Whether this factor contributes to the numeric score. */
  scored: boolean;
  remediation: string | null;
  details?: string[];
};

export function healthBadge(
  project: { hasManifest: boolean },
  doctor?: ProjectDoctorHealthInput | null,
): ProjectHealthLevel {
  return computeProjectHealth(project, doctor).level;
}

/** Score 0–100 from doctor checks; null when there is nothing useful to score yet. */
export function computeProjectHealth(
  project: { hasManifest: boolean },
  doctor?: ProjectDoctorHealthInput | null,
): ProjectHealthSummary {
  if (!project.hasManifest && !doctor?.manifest) {
    return { score: null, level: "missing", label: "No manifest" };
  }
  if (!doctor) {
    return { score: null, level: "warn", label: "…" };
  }
  if (!doctor.repoExists) {
    return { score: 0, level: "warn", label: "0 · path missing" };
  }

  let score = 100;
  for (const factor of projectHealthFactors(project, doctor)) {
    if (factor.scored && !factor.ok) {
      score -= factor.penalty;
    }
  }
  score = Math.max(0, Math.min(100, score));

  const level: ProjectHealthLevel =
    score >= 90 ? "ok" : score > 0 || doctor.manifest ? "warn" : "missing";
  const label =
    level === "ok"
      ? `${score} · Healthy`
      : level === "missing"
        ? "No manifest"
        : `${score} · Attention`;
  return { score, level, label };
}

/**
 * Scored + informational factors derived from the same doctor fields as
 * {@link computeProjectHealth}. Callers pass optional workspace-file checks for
 * checklist rows that do not affect the numeric score.
 */
export function projectHealthFactors(
  project: { hasManifest: boolean; repoPath?: string },
  doctor?: ProjectDoctorHealthInput | null,
  extras?: {
    workspaceFiles?: {
      trackedGeneratedFiles: string[];
      unignoredGeneratedFiles: string[];
      untrackedRegistrationFiles: string[];
    } | null;
  },
): ProjectHealthFactor[] {
  if (!doctor) {
    return [];
  }

  const repoPath = project.repoPath ?? "the project repository";
  const factors: ProjectHealthFactor[] = [];

  factors.push({
    id: "repo-path",
    label: doctor.repoExists ? "Repository path exists" : "Repository path is missing",
    ok: doctor.repoExists,
    penalty: doctor.repoExists ? 0 : 100,
    scored: true,
    remediation: doctor.repoExists
      ? null
      : `Fix the registered path so it points at an existing checkout (${repoPath}), then refresh Health.`,
  });

  if (!doctor.repoExists) {
    return factors;
  }

  factors.push({
    id: "manifest",
    label: doctor.manifest ? "Manifest file found" : "Manifest file not found",
    ok: doctor.manifest,
    penalty: doctor.manifest ? 0 : 35,
    scored: true,
    remediation: doctor.manifest
      ? null
      : "Add gojo.yaml (or .gojo/project.yaml) in the repo, then Sync the project.",
  });

  const dirtyFiles = doctor.baseCheckout.dirtyFiles ?? [];
  factors.push({
    id: "local-changes",
    label: doctor.baseCheckout.clean
      ? "Base checkout is clean"
      : "Base checkout has local changes",
    ok: doctor.baseCheckout.clean,
    penalty: doctor.baseCheckout.clean ? 0 : 20,
    scored: true,
    remediation: doctor.baseCheckout.clean
      ? null
      : `In ${repoPath}, commit, stash, or discard changes until git status is clean.`,
    ...(dirtyFiles.length > 0 ? { details: dirtyFiles } : {}),
  });

  const behind = doctor.baseCheckout.behindOrigin ?? 0;
  const behindPenalty = behind > 0 ? Math.min(15, behind * 2) : 0;
  factors.push({
    id: "behind-origin",
    label:
      behind > 0
        ? `Base checkout is ${behind} commit(s) behind origin`
        : "Base checkout is up to date with origin",
    ok: behind <= 0,
    penalty: behindPenalty,
    scored: true,
    remediation:
      behind > 0
        ? `In ${repoPath}, fetch and merge or rebase the default branch onto origin.`
        : null,
  });

  const missingTools = doctor.validationTools.filter((tool) => !tool.found);
  const toolsPenalty =
    missingTools.length > 0 ? Math.min(40, missingTools.length * 10) : 0;
  if (doctor.validationTools.length === 0) {
    factors.push({
      id: "validation-tools",
      label: "No validation tool checks reported",
      ok: true,
      penalty: 0,
      scored: true,
      remediation: null,
    });
  } else {
    factors.push({
      id: "validation-tools",
      label:
        missingTools.length === 0
          ? "Validation tools found on daemon PATH"
          : `${missingTools.length} validation tool(s) missing on daemon PATH`,
      ok: missingTools.length === 0,
      penalty: toolsPenalty,
      scored: true,
      remediation:
        missingTools.length === 0
          ? null
          : "Install missing binaries where the gojo daemon runs, or update agent validation steps.",
      details: missingTools.map((tool) => {
        const binary = tool.binary ?? "tool";
        const where =
          tool.agent && tool.step ? `${tool.agent} / ${tool.step}` : "validation";
        return `${binary} — ${where}`;
      }),
    });
  }

  const workspace = extras?.workspaceFiles;
  if (workspace) {
    const generatedOk =
      workspace.trackedGeneratedFiles.length === 0 &&
      workspace.unignoredGeneratedFiles.length === 0;
    factors.push({
      id: "workspace-generated",
      label: generatedOk
        ? "Generated .gojo run files are ignored by git"
        : "Generated .gojo run files are tracked or unignored",
      ok: generatedOk,
      penalty: 0,
      scored: false,
      remediation: generatedOk
        ? null
        : "Remove generated files from the index (git rm --cached) and add the suggested .gitignore block.",
      details: [
        ...workspace.trackedGeneratedFiles.map((file) => `${file} — committed to the repo`),
        ...workspace.unignoredGeneratedFiles.map(
          (file) => `${file} — not covered by .gitignore`,
        ),
      ],
    });

    if (workspace.untrackedRegistrationFiles.length > 0) {
      factors.push({
        id: "workspace-registration",
        label: "Registration files not tracked by git",
        ok: false,
        penalty: 0,
        scored: false,
        remediation:
          "Commit registration files (gojo.yaml, .gojo/agents, instructions) so remotes and sync stay aligned.",
        details: workspace.untrackedRegistrationFiles,
      });
    }
  }

  return factors;
}
