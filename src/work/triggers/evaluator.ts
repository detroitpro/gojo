import type { IssueLabelTriggerSchema } from '@shared/manifest';
import type { WorkDelivery } from '@shared/work';
import type { z } from 'zod';

export type IssueLabelTrigger = z.infer<typeof IssueLabelTriggerSchema>;

export interface TriggerWorkItem {
  kind: string;
  delivery: WorkDelivery;
  labels: string[];
}

export interface LabelActor {
  label: string;
  action: 'add' | 'remove';
  actor: string;
  occurredAt?: string;
}

export type TriggerRejectionReason =
  | 'wrong-kind'
  | 'not-open'
  | 'missing-required-label'
  | 'missing-affinity'
  | 'excluded-label'
  | 'claim-cap'
  | 'missing-authorization'
  | 'untrusted-actor';

export type TriggerEvaluation =
  | { eligible: true; authorizationLabel: string; reason: 'eligible' }
  | {
      eligible: false;
      authorizationLabel?: string;
      reason: TriggerRejectionReason;
    };

export function evaluateIssueLabelTrigger(input: {
  trigger: IssueLabelTrigger;
  item: TriggerWorkItem;
  previousLabels: readonly string[];
  openClaims: number;
  labelActors: readonly LabelActor[];
}): TriggerEvaluation {
  if (input.item.kind !== 'issue') {
    return { eligible: false, reason: 'wrong-kind' };
  }
  if (input.item.delivery !== 'open') {
    return { eligible: false, reason: 'not-open' };
  }

  const labels = new Set(input.item.labels);
  if (!input.trigger.requireLabels.every((label) => labels.has(label))) {
    return { eligible: false, reason: 'missing-required-label' };
  }
  if (
    input.trigger.anyLabels &&
    !input.trigger.anyLabels.some((label) => labels.has(label))
  ) {
    return { eligible: false, reason: 'missing-affinity' };
  }
  if (input.trigger.excludeLabels?.some((label) => labels.has(label))) {
    return { eligible: false, reason: 'excluded-label' };
  }
  if (input.openClaims >= input.trigger.maxOpenClaims) {
    return { eligible: false, reason: 'claim-cap' };
  }

  const authorizationLabel = input.trigger.requireLabels.includes('gojo:ready')
    ? 'gojo:ready'
    : input.trigger.requireLabels[0]!;
  const actor = [...input.labelActors]
    .reverse()
    .find((event) => event.label === authorizationLabel && event.action === 'add');
  if (!actor) {
    return {
      eligible: false,
      authorizationLabel,
      reason: 'missing-authorization',
    };
  }
  if (!input.trigger.trustedActors.includes(actor.actor)) {
    return {
      eligible: false,
      authorizationLabel,
      reason: 'untrusted-actor',
    };
  }

  return { eligible: true, authorizationLabel, reason: 'eligible' };
}
