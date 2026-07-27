import type {
  SourceCapabilities,
  WorkDelivery,
  WorkOutcome,
  WorkProvenance,
} from "@shared/work";

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

export interface SourceAdapter {
  readonly type: string;
  readonly capabilities: SourceCapabilities;
  listActive(input: SourceListInput): Promise<SourceListResult>;
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
