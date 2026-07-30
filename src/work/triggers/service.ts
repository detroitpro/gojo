import { AgentTriggerSchema } from '@shared/manifest';
import type { Run } from '@/storage/types';
import type { CreateRunInput } from '@/runs/coordinator';
import { createRepositories, createWorkRepositories } from '@/storage';
import type { Database } from '@/storage/db';

import {
  evaluateIssueLabelTrigger,
  type LabelActor,
} from './evaluator';

export interface ObserveWorkItemInput {
  workItemId: string;
  previousLabels: readonly string[];
  labelActors: readonly LabelActor[];
  comment?: (body: string) => Promise<void>;
  addLabels?: (labels: string[]) => Promise<void>;
}

export class WorkTriggerService {
  private readonly repos;
  private readonly work;
  private readonly enqueue: (input: CreateRunInput) => Promise<Run>;
  private readonly runUrl: (runId: string) => string;

  constructor(input: {
    db: Database;
    enqueue: (input: CreateRunInput) => Promise<Run>;
    runUrl?: (runId: string) => string;
  }) {
    this.repos = createRepositories(input.db);
    this.work = createWorkRepositories(input.db);
    this.enqueue = input.enqueue;
    this.runUrl = input.runUrl ?? ((runId) => runId);
  }

  async observe(input: ObserveWorkItemInput): Promise<Run[]> {
    const item = this.work.items.findById(input.workItemId);
    if (!item) return [];
    const runs: Run[] = [];

    for (const agent of this.repos.agents.listByProject(item.projectId)) {
      if (!agent.enabled) continue;
      const parsed = AgentTriggerSchema.safeParse(parseJson(agent.triggerJson));
      if (!parsed.success || parsed.data.on !== 'issue-label') continue;

      const idempotencyKey = `implement:${item.id}:${agent.id}`;
      const existing = this.repos.runs.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (!item.labels.includes('gojo:in-progress')) {
          await input.addLabels?.(['gojo:in-progress']);
          this.work.items.update(item.id, {
            labels: [...new Set([...item.labels, 'gojo:in-progress'])],
          });
        }
        continue;
      }

      const openClaims = this.repos.runs
        .listNonTerminal()
        .filter((run) => run.agentId === agent.id).length;
      const decision = evaluateIssueLabelTrigger({
        trigger: parsed.data,
        item,
        previousLabels: input.previousLabels,
        openClaims,
        labelActors: input.labelActors,
      });
      if (!decision.eligible) continue;

      const run = await this.enqueue({
        projectId: item.projectId,
        agentId: agent.id,
        trigger: 'work',
        idempotencyKey,
        subjectWorkItemId: item.id,
      });
      runs.push(run);
      await input.addLabels?.(['gojo:in-progress']);
      this.work.items.update(item.id, {
        labels: [...new Set([...item.labels, 'gojo:in-progress'])],
      });
      await input.comment?.(
        `Gojo claimed this issue with agent \`${agent.name}\`: ${this.runUrl(run.id)}`,
      );
      break;
    }

    return runs;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
