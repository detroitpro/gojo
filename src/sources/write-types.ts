export type SourceItemKind = "pull-request" | "issue";

export interface SourceItemOperationInput {
  baseUrl: string;
  externalKey: string;
  kind: SourceItemKind;
  nativeKey: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
}

export interface NormalizedSourceComment {
  id: string;
  body: string;
  actor: string | null;
  createdAt: string;
  updatedAt?: string | null;
  webUrl?: string | null;
}

export interface NormalizedSourceLabelActor {
  id: string;
  actor: string | null;
  action: "added" | "removed";
  label: string;
  occurredAt: string;
}

export interface SourceCommentInput extends SourceItemOperationInput {
  body: string;
}

export interface SourceSetLabelsInput extends SourceItemOperationInput {
  add?: readonly string[];
  remove?: readonly string[];
}

export type SourceCheckStatus = "pending" | "success" | "failure";

export interface NormalizedSourceCheck {
  id: string;
  name: string;
  status: SourceCheckStatus;
  details?: string | null;
  webUrl?: string | null;
}

export interface SourceChecksResult {
  status: SourceCheckStatus;
  checks: NormalizedSourceCheck[];
}

export type SourceMergeStyle = "squash" | "merge" | "rebase";

export interface SourceMergePullRequestInput extends SourceItemOperationInput {
  kind: "pull-request";
  style: SourceMergeStyle;
  deleteBranch?: boolean;
  whenChecksSucceed?: boolean;
}

export interface SourceMergePullRequestResult {
  status: "merged" | "scheduled" | "blocked";
  detail: string | null;
  mergeSha?: string | null;
}
