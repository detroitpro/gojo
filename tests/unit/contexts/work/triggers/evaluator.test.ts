import { describe, expect, test } from 'bun:test';

import { evaluateIssueLabelTrigger } from '@/contexts/work/application/triggers/evaluator';

const trigger = {
  on: 'issue-label' as const,
  requireLabels: ['gojo:ready', 'gojo:validated'],
  anyLabels: ['area:daemon', 'area:api'],
  excludeLabels: ['gojo:blocked', 'gojo:in-progress'],
  trustedActors: ['detroitpro'],
  maxOpenClaims: 1,
};

describe('work trigger evaluator', () => {
  test('accepts an open matching issue authorized by a trusted actor', () => {
    expect(
      evaluateIssueLabelTrigger({
        trigger,
        item: {
          kind: 'issue',
          delivery: 'open',
          labels: ['gojo:ready', 'gojo:validated', 'area:api'],
        },
        previousLabels: ['gojo:validated', 'area:api'],
        openClaims: 0,
        labelActors: [{ label: 'gojo:ready', action: 'add', actor: 'detroitpro' }],
      }),
    ).toEqual({
      eligible: true,
      authorizationLabel: 'gojo:ready',
      reason: 'eligible',
    });
  });

  test('rejects untrusted label actors, exclusions, missing affinity, and claim caps', () => {
    const base = {
      trigger,
      item: {
        kind: 'issue',
        delivery: 'open' as const,
        labels: ['gojo:ready', 'gojo:validated', 'area:api'],
      },
      previousLabels: [],
      openClaims: 0,
      labelActors: [{ label: 'gojo:ready', action: 'add' as const, actor: 'outsider' }],
    };

    expect(evaluateIssueLabelTrigger(base)).toMatchObject({
      eligible: false,
      reason: 'untrusted-actor',
    });
    expect(
      evaluateIssueLabelTrigger({
        ...base,
        item: { ...base.item, labels: [...base.item.labels, 'gojo:blocked'] },
        labelActors: [{ label: 'gojo:ready', action: 'add', actor: 'detroitpro' }],
      }),
    ).toMatchObject({ eligible: false, reason: 'excluded-label' });
    expect(
      evaluateIssueLabelTrigger({
        ...base,
        item: { ...base.item, labels: ['gojo:ready', 'gojo:validated', 'area:web'] },
        labelActors: [{ label: 'gojo:ready', action: 'add', actor: 'detroitpro' }],
      }),
    ).toMatchObject({ eligible: false, reason: 'missing-affinity' });
    expect(
      evaluateIssueLabelTrigger({
        ...base,
        openClaims: 1,
        labelActors: [{ label: 'gojo:ready', action: 'add', actor: 'detroitpro' }],
      }),
    ).toMatchObject({ eligible: false, reason: 'claim-cap' });
  });

  test('rejects non-issue, terminal, and incomplete work', () => {
    const base = {
      trigger,
      previousLabels: [],
      openClaims: 0,
      labelActors: [{ label: 'gojo:ready', action: 'add' as const, actor: 'detroitpro' }],
    };

    expect(
      evaluateIssueLabelTrigger({
        ...base,
        item: {
          kind: 'pull-request',
          delivery: 'open',
          labels: ['gojo:ready', 'gojo:validated', 'area:api'],
        },
      }),
    ).toMatchObject({ eligible: false, reason: 'wrong-kind' });
    expect(
      evaluateIssueLabelTrigger({
        ...base,
        item: {
          kind: 'issue',
          delivery: 'closed',
          labels: ['gojo:ready', 'gojo:validated', 'area:api'],
        },
      }),
    ).toMatchObject({ eligible: false, reason: 'not-open' });
    expect(
      evaluateIssueLabelTrigger({
        ...base,
        item: { kind: 'issue', delivery: 'open', labels: ['gojo:ready', 'area:api'] },
      }),
    ).toMatchObject({ eligible: false, reason: 'missing-required-label' });
  });

  test('rejects issues that lack a trusted authorization label actor', () => {
    expect(
      evaluateIssueLabelTrigger({
        trigger,
        item: {
          kind: 'issue',
          delivery: 'open',
          labels: ['gojo:ready', 'gojo:validated', 'area:api'],
        },
        previousLabels: [],
        openClaims: 0,
        labelActors: [],
      }),
    ).toEqual({
      eligible: false,
      authorizationLabel: 'gojo:ready',
      reason: 'missing-authorization',
    });
  });
});
