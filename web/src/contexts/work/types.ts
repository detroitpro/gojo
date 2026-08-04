export type {
  SourceSyncState,
  WorkAttention,
  WorkDelivery,
  WorkExecution,
  WorkOutcome,
  WorkProvenance,
  WorkRecheckStatus,
  WorkResolution,
  WorkStatusCompareWindow,
  WorkStatusCounts,
  WorkItem as ContractWorkItem,
  WorkRecheckResult as ContractWorkRecheckResult,
} from "@gojo/contracts/types";

import type {
  SourceSyncState,
  WorkItem as ContractWorkItem,
  WorkRecheckResult as ContractWorkRecheckResult,
  WorkStatusCompareWindow,
  WorkStatusCounts,
} from "@gojo/contracts/types";

/** Work item row; adds UI attribution fields beyond the contract shape. */
export type WorkItem = ContractWorkItem & {
  agentName?: string | null;
  agentLabel?: string | null;
  deliveredWork?: WorkItem[];
};

export type WorkRecheckResult = Omit<ContractWorkRecheckResult, "work"> & {
  work: WorkItem;
};

export interface WorkStatus extends WorkStatusCounts {
  asOf: string | null;
  previous: WorkStatusCounts | null;
  previousAsOf: string | null;
  compareWindow: WorkStatusCompareWindow;
}

export interface ProjectSource {
  id: string;
  projectId: string;
  connectionId: string | null;
  kind: string;
  externalKey: string;
  displayName: string;
  webUrl: string | null;
  syncState: SourceSyncState;
  observedAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  connection: {
    id: string;
    name: string;
    adapter: string;
    capabilities: { workKinds: string[] };
  } | null;
}
