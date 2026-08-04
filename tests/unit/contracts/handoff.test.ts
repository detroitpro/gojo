import { describe, expect, test } from 'bun:test';

import {
  AgentHandoffReportSchema,
  extractHandoffImpactItems,
  extractHandoffSubjectActions,
  normalizeAgentHandoff,
  parseAgentHandoffReport,
  recoverAgentHandoffReport,
  safeParseAgentHandoffReport,
} from '@shared/handoff';

const validHandoff = {
  schemaVersion: 1,
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  status: 'completed',
  summary: 'Updated three dependencies and corrected two incompatible API calls.',
  startingCommit: 'abc123',
  resultCommit: 'def456',
  filesChanged: ['package.json', 'pnpm-lock.yaml', 'src/client.ts'],
  validation: {
    passed: true,
    steps: [
      { name: 'lint', status: 'passed' },
      { name: 'test', status: 'passed' },
    ],
  },
  decisions: [
    'Did not upgrade package X because version 5 requires a framework migration.',
  ],
  unresolvedIssues: ['Package Y remains deprecated and needs replacement.'],
  recommendedNextActions: ['Create a separate migration task for package Y.'],
  agentAssessment: {
    successful: true,
    confidence: 0.86,
  },
} as const;

describe('AgentHandoffReport', () => {
  test('parses valid handoff report matching PRD §14 example', () => {
    const report = parseAgentHandoffReport(validHandoff);

    expect(report.schemaVersion).toBe(1);
    expect(report.runId).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(report.status).toBe('completed');
    expect(report.validation.passed).toBe(true);
    expect(report.validation.steps).toHaveLength(2);
    expect(report.agentAssessment.confidence).toBe(0.86);
  });

  test('safeParse succeeds for valid payload', () => {
    const result = safeParseAgentHandoffReport(validHandoff);
    expect(result.success).toBe(true);
  });

  test('rejects missing required fields', () => {
    const { summary: _summary, ...incomplete } = validHandoff;
    const result = AgentHandoffReportSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  test('rejects invalid runId', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      runId: '01K123ABC',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid status', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      status: 'done',
    });
    expect(result.success).toBe(false);
  });

  test('rejects confidence outside 0-1 range', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      agentAssessment: { successful: true, confidence: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  test('accepts schema version 2', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      schemaVersion: 2,
    });
    expect(result.success).toBe(true);
  });

  test('accepts schema version 3 subject actions for platform application', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      schemaVersion: 3,
      subjectActions: {
        addLabels: ['gojo:validated'],
        removeLabels: ['gojo:needs-detail'],
        comment: 'Issue is sufficiently specified.',
        verdict: 'pass',
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid subject action verdicts and empty labels', () => {
    for (const subjectActions of [
      { verdict: 'looks-good-to-me' },
      { addLabels: [''] },
    ]) {
      expect(
        AgentHandoffReportSchema.safeParse({
          ...validHandoff,
          schemaVersion: 3,
          subjectActions,
        }).success,
      ).toBe(false);
    }
  });

  test('rejects unsupported schema version', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      schemaVersion: 4,
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty summary', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      summary: '',
    });
    expect(result.success).toBe(false);
  });

  test('accepts optional prUrl from platform integration', () => {
    const report = parseAgentHandoffReport({
      ...validHandoff,
      prUrl: 'http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/54',
    });
    expect(report.prUrl).toContain('/pulls/54');
  });

  test('accepts optional assets with path or content', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      assets: [
        {
          role: 'pr-body',
          path: '.gojo/assets/pr-body.md',
          mediaType: 'text/markdown',
          label: 'PR description',
        },
        {
          role: 'pr-title',
          content: 'Short PR title',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assets).toHaveLength(2);
    }
  });

  test('rejects asset with neither path nor content', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      assets: [{ role: 'attachment', label: 'empty' }],
    });
    expect(result.success).toBe(false);
  });

  test('accepts v2 impact items and applies defaults', () => {
    const report = parseAgentHandoffReport({
      ...validHandoff,
      schemaVersion: 2,
      impact: {
        items: [
          {
            category: 'dependency-update',
            subject: 'croner',
            summary: 'Upgraded croner 8 -> 9',
            evidence: { files: ['package.json'] },
          },
        ],
      },
    });
    expect(report.impact?.items).toHaveLength(1);
    expect(report.impact?.items[0]?.confidence).toBe(0.5);
    expect(report.impact?.items[0]?.evidence.references).toEqual([]);
  });

  test('rejects impact item with unknown category or empty subject', () => {
    const bad = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      schemaVersion: 2,
      impact: { items: [{ category: 'world-peace', subject: 'x', summary: 'y' }] },
    });
    expect(bad.success).toBe(false);

    const empty = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      schemaVersion: 2,
      impact: { items: [{ category: 'bug-fix', subject: '', summary: 'y' }] },
    });
    expect(empty.success).toBe(false);
  });
});

describe('normalizeAgentHandoff', () => {
  test('returns report with no warnings for valid payload', () => {
    const normalized = normalizeAgentHandoff(validHandoff);
    expect(normalized.report?.runId).toBe(validHandoff.runId);
    expect(normalized.warnings).toEqual([]);
  });

  test('returns null report and readable warnings for invalid payload', () => {
    const normalized = normalizeAgentHandoff({ schemaVersion: 1, summary: '' });
    expect(normalized.report).toBeNull();
    expect(normalized.warnings.length).toBeGreaterThan(0);
    expect(normalized.warnings[0]).toContain(':');
  });
});

describe('extractHandoffImpactItems', () => {
  test('extracts valid impact from otherwise invalid handoff', () => {
    const { items, invalid } = extractHandoffImpactItems({
      summary: '',
      impact: {
        items: [
          { category: 'documentation', subject: 'docs/setup.md', summary: 'Rewrote setup' },
        ],
      },
    });
    expect(invalid).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]?.category).toBe('documentation');
  });

  test('flags invalid impact sections without throwing', () => {
    const { items, invalid } = extractHandoffImpactItems({ impact: { items: 'nope' } });
    expect(items).toEqual([]);
    expect(invalid).toBe(true);
  });

  test('returns empty for missing impact', () => {
    const { items, invalid } = extractHandoffImpactItems({ summary: 'hi' });
    expect(items).toEqual([]);
    expect(invalid).toBe(false);
  });
});

describe('recoverAgentHandoffReport', () => {
  test('keeps subjectActions when impact category is invalid', () => {
    const recovered = recoverAgentHandoffReport({
      ...validHandoff,
      schemaVersion: 3,
      subjectActions: {
        verdict: 'pass',
        comment: 'LGTM',
      },
      impact: {
        items: [
          {
            category: 'code-quality',
            subject: 'decks',
            summary: 'Thinned route shell',
          },
        ],
      },
    });

    expect(recovered.report).not.toBeNull();
    expect(recovered.report?.subjectActions?.verdict).toBe('pass');
    expect(recovered.report?.impact).toBeUndefined();
    expect(recovered.warnings.some((warning) => warning.includes('impact'))).toBe(
      true,
    );
  });

  test('still fails when required core fields are missing', () => {
    const recovered = recoverAgentHandoffReport({
      schemaVersion: 3,
      subjectActions: { verdict: 'pass' },
      impact: {
        items: [{ category: 'code-quality', subject: 'x', summary: 'y' }],
      },
    });
    expect(recovered.report).toBeNull();
    expect(recovered.warnings.length).toBeGreaterThan(0);
  });
});

describe('extractHandoffSubjectActions', () => {
  test('extracts valid subjectActions from otherwise invalid handoff', () => {
    const actions = extractHandoffSubjectActions({
      summary: '',
      subjectActions: { verdict: 'changes-requested', comment: 'Fix tests' },
    });
    expect(actions?.verdict).toBe('changes-requested');
    expect(actions?.comment).toBe('Fix tests');
  });

  test('returns null for invalid subjectActions', () => {
    expect(
      extractHandoffSubjectActions({
        subjectActions: { verdict: 'looks-good-to-me' },
      }),
    ).toBeNull();
  });
});
