import { describe, expect, test } from 'bun:test';

import {
  assessAgentImpactItems,
  buildRunImpactRecords,
  derivePlatformImpactItems,
} from '@/runs/impact';
import type { HandoffImpactItem } from '@shared/handoff';

function agentItem(overrides: Partial<HandoffImpactItem> = {}): HandoffImpactItem {
  return {
    category: 'bug-fix',
    subject: 'issue-42',
    summary: 'Fixed crash on empty manifest',
    confidence: 0.8,
    evidence: { files: [], validationSteps: [], references: [] },
    ...overrides,
  };
}

describe('derivePlatformImpactItems', () => {
  test('classifies dependency, doc, and test files as verified platform facts', () => {
    const items = derivePlatformImpactItems([
      'package.json',
      'bun.lock',
      'docs/setup.md',
      'site/src/pages/faq.md',
      'tests/unit/foo.test.ts',
      'src/main.ts',
    ]);

    const categories = items.map((item) => `${item.category}:${item.subject}`);
    expect(categories).toContain('dependency-update:package.json');
    expect(categories).toContain('dependency-update:bun.lock');
    expect(categories).toContain('documentation:docs/setup.md');
    expect(categories).toContain('documentation:site/src/pages/faq.md');
    expect(categories).toContain('test-coverage:tests/unit/foo.test.ts');
    expect(categories.some((c) => c.endsWith('src/main.ts'))).toBe(false);
    expect(items.every((item) => item.verification === 'verified')).toBe(true);
    expect(items.every((item) => item.source === 'platform')).toBe(true);
  });

  test('test files win over doc classification and dedupes repeats', () => {
    const items = derivePlatformImpactItems(['tests/README.md', 'tests/README.md']);
    expect(items).toHaveLength(1);
    expect(items[0]?.category).toBe('test-coverage');
  });
});

describe('assessAgentImpactItems', () => {
  test('corroborates claims whose evidence files match the diff', () => {
    const [matched, unmatched] = assessAgentImpactItems(
      [
        agentItem({ evidence: { files: ['src/a.ts'], validationSteps: [], references: [] } }),
        agentItem({ subject: 'issue-43', evidence: { files: ['src/other.ts'], validationSteps: [], references: [] } }),
      ],
      ['src/a.ts', 'src/b.ts'],
    );
    expect(matched?.verification).toBe('corroborated');
    expect(unmatched?.verification).toBe('claimed');
    expect(matched?.source).toBe('agent');
    expect(matched?.confidence).toBe(0.8);
  });
});

describe('buildRunImpactRecords', () => {
  test('merges platform and agent records, upgrading agent claims on the same subject', () => {
    const records = buildRunImpactRecords({
      agentItems: [
        agentItem({
          category: 'dependency-update',
          subject: 'package.json',
          summary: 'Bumped croner to v9',
          evidence: { files: ['package.json'], validationSteps: [], references: [] },
        }),
        agentItem(),
      ],
      filesChanged: ['package.json', 'src/fix.ts'],
    });

    const dep = records.find((record) => record.category === 'dependency-update');
    expect(dep?.source).toBe('agent');
    expect(dep?.summary).toBe('Bumped croner to v9');
    expect(dep?.verification).toBe('verified');

    const bug = records.find((record) => record.category === 'bug-fix');
    expect(bug?.verification).toBe('claimed');

    // one record per (category, subject) — no duplicate for package.json
    expect(records.filter((record) => record.subject === 'package.json')).toHaveLength(1);
  });

  test('keeps the first of duplicate agent claims', () => {
    const records = buildRunImpactRecords({
      agentItems: [
        agentItem({ summary: 'first' }),
        agentItem({ summary: 'second' }),
      ],
      filesChanged: [],
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.summary).toBe('first');
  });
});
