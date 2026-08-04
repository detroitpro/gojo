import type {
  SourceCapabilities,
  WorkDelivery,
  WorkOutcome,
  WorkProvenance,
} from "@shared/work";

import type {
  NormalizedSourceComment,
  NormalizedSourceLabelActor,
  SourceChecksResult,
  SourceCommentInput,
  SourceItemOperationInput,
  SourceMergePullRequestInput,
  SourceMergePullRequestResult,
  SourceSetLabelsInput,
} from "@/contexts/work/domain/write-types";

export interface NormalizedSourceItem {
  kind: string;
  nativeKey: string;
  title: string;
  summary: string;
  delivery: WorkDelivery;
  outcome: WorkOutcome;
  provenance: WorkProvenance;
  actorName?: string | null;
  labels: string[];
  nativeState: string;
  nativeJson: string;
  webUrl?: string | null;
  observedAt: string;
  reviewJson?: string;
  checksJson?: string;
  mergeability?: string | null;
}

export interface SourceListInput {
  baseUrl: string;
  externalKey: string;
  cursor?: string | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
}

export interface SourceListResult {
  items: NormalizedSourceItem[];
  cursor: string | null;
  backfillComplete: boolean;
}

export interface SourceGetItemInput {
  baseUrl: string;
  externalKey: string;
  kind: string;
  nativeKey: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
}

export type SourceGetItemResult =
  | { status: "found"; item: NormalizedSourceItem }
  | { status: "unresolved"; detail: string };

export interface SourceAdapter {
  readonly type: string;
  readonly capabilities: SourceCapabilities;
  listActive(input: SourceListInput): Promise<SourceListResult>;
  getItem?(input: SourceGetItemInput): Promise<SourceGetItemResult>;
  listComments?(input: SourceItemOperationInput): Promise<NormalizedSourceComment[]>;
  listLabelActors?(input: SourceItemOperationInput): Promise<NormalizedSourceLabelActor[]>;
  comment?(input: SourceCommentInput): Promise<NormalizedSourceComment>;
  setLabels?(input: SourceSetLabelsInput): Promise<string[]>;
  getDiff?(input: SourceItemOperationInput): Promise<string>;
  getChecks?(input: SourceItemOperationInput): Promise<SourceChecksResult>;
  mergePullRequest?(
    input: SourceMergePullRequestInput,
  ): Promise<SourceMergePullRequestResult>;
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  constructor(adapters: readonly SourceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): SourceAdapter | null {
    return this.adapters.get(type) ?? null;
  }

  list(): SourceAdapter[] {
    return [...this.adapters.values()];
  }
}
