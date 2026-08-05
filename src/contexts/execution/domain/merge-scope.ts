import type { AgentMergePolicy, ProjectManifest } from '@shared/manifest';

import { RUN_BRANCH_NAMESPACE } from '@/contexts/execution/domain/run-branch';

export type MergeScope = {
  agentNames: string[];
  headPrefixes: string[];
};

const DEFAULT_STAR_EXCLUDES = ['self-heal'] as const;

/**
 * Resolve which sibling agents a merge/babysit agent may touch from its
 * `mergePolicy` and the project's agent set.
 */
export function resolveMergeScope(input: {
  mergeAgentName: string;
  policy: AgentMergePolicy;
  projectAgents: ReadonlyArray<{ name: string; enabled: boolean }>;
}): MergeScope {
  const excluded = new Set<string>([
    input.mergeAgentName,
    ...(input.policy.excludeAgents ?? []),
  ]);
  if (input.policy.includeAgents === '*') {
    for (const name of DEFAULT_STAR_EXCLUDES) {
      excluded.add(name);
    }
  }

  let names: string[];
  if (input.policy.includeAgents === '*') {
    names = input.projectAgents
      .filter((agent) => agent.enabled && !excluded.has(agent.name))
      .map((agent) => agent.name)
      .sort();
  } else {
    const enabled = new Set(
      input.projectAgents.filter((a) => a.enabled).map((a) => a.name),
    );
    names = [
      ...new Set(
        input.policy.includeAgents.filter(
          (name) => !excluded.has(name) && enabled.has(name),
        ),
      ),
    ].sort();
  }

  return {
    agentNames: names,
    headPrefixes: names.map((name) => `${RUN_BRANCH_NAMESPACE}/${name}/`),
  };
}

/** Read mergePolicy for an agent from a synced project manifest, if present. */
export function mergePolicyFromManifest(
  manifest: ProjectManifest | null | undefined,
  agentName: string,
): AgentMergePolicy | null {
  if (!manifest) return null;
  const config = manifest.agents[agentName];
  return config?.mergePolicy ?? null;
}

/** Platform prompt block injected for merge-policy agents. */
export function formatMergeScopePrompt(scope: MergeScope): string {
  if (scope.headPrefixes.length === 0) {
    return `## Gojo merge scope (platform)

No sibling agents are currently in scope for merge. Exit successfully with an empty-action handoff if there is nothing allowlisted to babysit.
`;
  }

  const bullets = scope.headPrefixes.map((prefix) => `- \`${prefix}\``).join('\n');
  return `## Gojo merge scope (platform)

You may babysit and merge open pull requests whose **head branch** starts with any of:

${bullets}

Match on head branch first. Do **not** invent additional branch patterns. Skip PRs outside this list (human feature branches, Dependabot, agents not listed above).
`;
}
