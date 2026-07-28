import type {
  HandoffImpactCategory,
  HandoffImpactItem,
} from '@shared/handoff';

export type ImpactSource = 'agent' | 'platform';

/** Trust ladder: claimed < corroborated < verified. */
export type ImpactVerification = 'claimed' | 'corroborated' | 'verified';

export interface RunImpactDraft {
  category: HandoffImpactCategory;
  subject: string;
  summary: string;
  source: ImpactSource;
  verification: ImpactVerification;
  confidence: number | null;
  evidence: {
    files: string[];
    validationSteps: string[];
    references: string[];
  };
}

const DEPENDENCY_FILE =
  /(^|\/)(package\.json|bun\.lockb?|bun\.lock|yarn\.lock|pnpm-lock\.yaml|package-lock\.json|Cargo\.(toml|lock)|go\.(mod|sum)|requirements[^/]*\.txt|poetry\.lock|Pipfile(\.lock)?|Gemfile(\.lock)?|composer\.(json|lock))$/i;

const DOC_FILE = /(^(docs|site)\/)|(\.(md|mdx|rst|adoc)$)/i;

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

function normalizeSubject(value: string): string {
  return value.trim().toLowerCase();
}

function inferImpactFromPath(
  file: string,
): { category: HandoffImpactCategory; summary: string } | null {
  if (DEPENDENCY_FILE.test(file)) {
    return {
      category: 'dependency-update',
      summary: 'Dependency manifest or lockfile changed',
    };
  }
  if (TEST_FILE.test(file)) {
    return { category: 'test-coverage', summary: 'Test file changed' };
  }
  if (DOC_FILE.test(file)) {
    return { category: 'documentation', summary: 'Documentation file changed' };
  }
  return null;
}

/**
 * Derive machine-detectable impact from the observed changed files.
 * These are platform facts and recorded as `verified`.
 */
export function derivePlatformImpactItems(filesChanged: string[]): RunImpactDraft[] {
  const drafts: RunImpactDraft[] = [];
  const seen = new Set<string>();

  for (const file of filesChanged) {
    const trimmed = file.trim();
    if (!trimmed) {
      continue;
    }
    const inferred = inferImpactFromPath(trimmed);
    if (!inferred) {
      continue;
    }
    const key = `${inferred.category}\u0000${normalizeSubject(trimmed)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    drafts.push({
      category: inferred.category,
      subject: trimmed,
      summary: inferred.summary,
      source: 'platform',
      verification: 'verified',
      confidence: null,
      evidence: { files: [trimmed], validationSteps: [], references: [] },
    });
  }

  return drafts;
}

/**
 * Assess agent claims against observed changed files.
 * Claims whose evidence files intersect the real diff are `corroborated`;
 * everything else stays `claimed`.
 */
export function assessAgentImpactItems(
  items: HandoffImpactItem[],
  filesChanged: string[],
): RunImpactDraft[] {
  const changed = new Set(filesChanged.map(normalizeSubject));

  return items.map((item) => {
    const evidenceFiles = item.evidence.files.map((file) => file.trim()).filter(Boolean);
    const corroborated = evidenceFiles.some((file) => changed.has(normalizeSubject(file)));
    return {
      category: item.category,
      subject: item.subject.trim(),
      summary: item.summary.trim(),
      source: 'agent',
      verification: corroborated ? 'corroborated' : 'claimed',
      confidence: item.confidence,
      evidence: {
        files: evidenceFiles,
        validationSteps: item.evidence.validationSteps,
        references: item.evidence.references,
      },
    };
  });
}

/**
 * Merge platform facts and agent claims into one canonical list.
 * One record per (category, subject); when both sources describe the same
 * subject the agent's summary is kept and the record is upgraded to `verified`.
 */
export function buildRunImpactRecords(input: {
  agentItems: HandoffImpactItem[];
  filesChanged: string[];
}): RunImpactDraft[] {
  const platform = derivePlatformImpactItems(input.filesChanged);
  const agent = assessAgentImpactItems(input.agentItems, input.filesChanged);

  const byKey = new Map<string, RunImpactDraft>();
  for (const draft of platform) {
    byKey.set(`${draft.category}\u0000${normalizeSubject(draft.subject)}`, draft);
  }

  for (const draft of agent) {
    if (!draft.subject) {
      continue;
    }
    const key = `${draft.category}\u0000${normalizeSubject(draft.subject)}`;
    const existing = byKey.get(key);
    if (existing?.source === 'platform') {
      byKey.set(key, { ...draft, verification: 'verified' });
    } else if (!existing) {
      byKey.set(key, draft);
    }
    // Duplicate agent claims for the same subject: keep the first.
  }

  return [...byKey.values()];
}
