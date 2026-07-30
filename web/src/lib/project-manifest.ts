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
