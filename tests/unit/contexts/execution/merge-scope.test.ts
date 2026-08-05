import { expect, test } from 'bun:test';

import {
  formatMergeScopePrompt,
  mergePolicyFromManifest,
  resolveMergeScope,
} from '@/contexts/execution/domain/merge-scope';
import { RUN_BRANCH_NAMESPACE } from '@/contexts/execution/domain/run-branch';
import type { ProjectManifest } from '@shared/manifest';

const agents = [
  { name: 'maintain-api-quality', enabled: true },
  { name: 'maintain-docs', enabled: true },
  { name: 'maintain-merge', enabled: true },
  { name: 'self-heal', enabled: true },
  { name: 'issue-implement', enabled: true },
  { name: 'disabled-agent', enabled: false },
];

test('resolveMergeScope expands explicit include list to gojo/run prefixes', () => {
  const scope = resolveMergeScope({
    mergeAgentName: 'maintain-merge',
    policy: {
      includeAgents: [
        'maintain-api-quality',
        'maintain-docs',
        'maintain-merge',
        'missing-agent',
      ],
      excludeAgents: ['maintain-docs'],
    },
    projectAgents: agents,
  });
  // Drop self, excluded, and names not present/enabled in the project.
  expect(scope.agentNames).toEqual(['maintain-api-quality']);
  expect(scope.headPrefixes).toEqual([
    `${RUN_BRANCH_NAMESPACE}/maintain-api-quality/`,
  ]);
});

test('resolveMergeScope star includes enabled siblings and default-excludes self-heal', () => {
  const scope = resolveMergeScope({
    mergeAgentName: 'maintain-merge',
    policy: { includeAgents: '*' },
    projectAgents: agents,
  });
  expect(scope.agentNames).toEqual([
    'issue-implement',
    'maintain-api-quality',
    'maintain-docs',
  ]);
  expect(scope.agentNames).not.toContain('maintain-merge');
  expect(scope.agentNames).not.toContain('self-heal');
  expect(scope.agentNames).not.toContain('disabled-agent');
});

test('resolveMergeScope honors excludeAgents with star', () => {
  const scope = resolveMergeScope({
    mergeAgentName: 'maintain-merge',
    policy: {
      includeAgents: '*',
      excludeAgents: ['issue-implement', 'self-heal'],
    },
    projectAgents: agents,
  });
  expect(scope.agentNames).toEqual(['maintain-api-quality', 'maintain-docs']);
});

test('mergePolicyFromManifest reads agent policy', () => {
  const manifest = {
    agents: {
      'maintain-merge': {
        mergePolicy: { includeAgents: ['maintain-docs'] },
      },
    },
  } as unknown as ProjectManifest;
  expect(mergePolicyFromManifest(manifest, 'maintain-merge')).toEqual({
    includeAgents: ['maintain-docs'],
  });
  expect(mergePolicyFromManifest(manifest, 'other')).toBeNull();
  expect(mergePolicyFromManifest(null, 'maintain-merge')).toBeNull();
});

test('formatMergeScopePrompt lists prefixes', () => {
  const text = formatMergeScopePrompt({
    agentNames: ['maintain-docs'],
    headPrefixes: [`${RUN_BRANCH_NAMESPACE}/maintain-docs/`],
  });
  expect(text).toContain('## Gojo merge scope (platform)');
  expect(text).toContain(`\`${RUN_BRANCH_NAMESPACE}/maintain-docs/\``);
  expect(text).toContain('Do **not** invent additional branch patterns');
});
