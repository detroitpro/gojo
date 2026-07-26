export type ManifestAgentView = {
  name: string;
  adapter: string;
  timeout?: string;
  model?: string;
};

export type ManifestTaskView = {
  name: string;
  description: string;
  agent: string;
  integrationMode: string;
};

export type ManifestScheduleView = {
  name: string;
  task: string;
  cron: string;
  timezone: string;
};

export type ManifestProfileView = {
  name: string;
  stepCount: number;
};

export type ParsedManifestView = {
  ok: boolean;
  error?: string;
  projectName?: string;
  defaultBranch?: string;
  repository: Record<string, unknown>;
  agents: ManifestAgentView[];
  tasks: ManifestTaskView[];
  schedules: ManifestScheduleView[];
  validationProfiles: ManifestProfileView[];
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
      agents: [],
      tasks: [],
      schedules: [],
      validationProfiles: [],
      prettyJson: raw,
    };
  }

  const root = asRecord(parsed) ?? {};
  const project = asRecord(root.project) ?? {};
  const repository = asRecord(root.repository) ?? {};
  const agentsRaw = asRecord(root.agents) ?? {};
  const tasksRaw = asRecord(root.tasks) ?? {};
  const schedulesRaw = asRecord(root.schedules) ?? {};
  const profilesRaw = asRecord(root.validationProfiles) ?? {};

  const agents: ManifestAgentView[] = Object.entries(agentsRaw).map(([name, value]) => {
    const cfg = asRecord(value) ?? {};
    return {
      name,
      adapter: typeof cfg.adapter === "string" ? cfg.adapter : "—",
      ...(typeof cfg.timeout === "string" ? { timeout: cfg.timeout } : {}),
      ...(typeof cfg.model === "string" ? { model: cfg.model } : {}),
    };
  });

  const tasks: ManifestTaskView[] = Object.entries(tasksRaw).map(([name, value]) => {
    const cfg = asRecord(value) ?? {};
    const integration = asRecord(cfg.integration) ?? {};
    return {
      name,
      description: typeof cfg.description === "string" ? cfg.description : "",
      agent: typeof cfg.agent === "string" ? cfg.agent : "—",
      integrationMode:
        typeof integration.mode === "string" ? integration.mode : "—",
    };
  });

  const schedules: ManifestScheduleView[] = Object.entries(schedulesRaw).map(
    ([name, value]) => {
      const cfg = asRecord(value) ?? {};
      return {
        name,
        task: typeof cfg.task === "string" ? cfg.task : "—",
        cron: typeof cfg.cron === "string" ? cfg.cron : "—",
        timezone: typeof cfg.timezone === "string" ? cfg.timezone : "—",
      };
    },
  );

  const validationProfiles: ManifestProfileView[] = Object.entries(profilesRaw).map(
    ([name, value]) => {
      const cfg = asRecord(value) ?? {};
      const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
      return { name, stepCount: steps.length };
    },
  );

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
    agents,
    tasks,
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

export function healthBadge(
  project: { hasManifest: boolean },
  doctor?: {
    repoExists: boolean;
    manifest: boolean;
    baseCheckout: { clean: boolean; behindOrigin?: number | null };
    validationTools: Array<{ found: boolean }>;
  } | null,
): ProjectHealthLevel {
  return computeProjectHealth(project, doctor).level;
}

/** Score 0–100 from doctor checks; null when there is nothing useful to score yet. */
export function computeProjectHealth(
  project: { hasManifest: boolean },
  doctor?: {
    repoExists: boolean;
    manifest: boolean;
    baseCheckout: { clean: boolean; behindOrigin?: number | null };
    validationTools: Array<{ found: boolean }>;
  } | null,
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
  if (!doctor.manifest) {
    score -= 35;
  }
  if (!doctor.baseCheckout.clean) {
    score -= 20;
  }
  const behind = doctor.baseCheckout.behindOrigin ?? 0;
  if (behind > 0) {
    score -= Math.min(15, behind * 2);
  }
  const missingTools = doctor.validationTools.filter((tool) => !tool.found).length;
  if (missingTools > 0) {
    score -= Math.min(40, missingTools * 10);
  }
  score = Math.max(0, Math.min(100, score));

  const level: ProjectHealthLevel = score >= 90 ? "ok" : score > 0 || doctor.manifest ? "warn" : "missing";
  const label =
    level === "ok" ? `${score} · Healthy` : level === "missing" ? "No manifest" : `${score} · Attention`;
  return { score, level, label };
}
