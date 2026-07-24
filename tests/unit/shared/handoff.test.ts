import { describe, expect, test } from 'bun:test';

import {
  AgentHandoffReportSchema,
  parseAgentHandoffReport,
  safeParseAgentHandoffReport,
} from '../../../src/shared/handoff';

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

  test('rejects unsupported schema version', () => {
    const result = AgentHandoffReportSchema.safeParse({
      ...validHandoff,
      schemaVersion: 2,
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
});
