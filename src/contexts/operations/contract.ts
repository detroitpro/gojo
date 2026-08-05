/**
 * Public surface of the operations context.
 */
export type {
  InstanceConfigStore,
  InstancePatch,
  InstanceView,
} from "./ports/instance-config-store";
export type { DiagnosticsPort } from "./ports/diagnostics";
export type { BackupCreateResult, BackupEntry, BackupStore } from "./ports/backup-store";
export type { FilesystemBrowser } from "./ports/filesystem-browser";
export type {
  DashboardImpact,
  DashboardOverview,
  DashboardReadModel,
  DashboardSummary,
  QueueSnapshot,
} from "./ports/dashboard-read-model";
export type { ProcessRunner, ProcessRunResult } from "./ports/process-runner";
export type { WorktreeSweepPort, WorktreeSweepResult } from "./ports/worktree-sweep";

export type { InstanceConfigDeps } from "./application/instance-config";
export {
  getInstanceQuery,
  pauseInstanceCommand,
  resumeInstanceCommand,
  updateInstanceCommand,
} from "./application/instance-config";
export { instanceDoctorQuery } from "./application/diagnostics";
export type { DashboardDeps } from "./application/dashboard";
export {
  dashboardImpactQuery,
  dashboardOverviewQuery,
  dashboardSummaryQuery,
  queueSnapshotQuery,
} from "./application/dashboard";
export type { BackupDeps } from "./application/backup";
export {
  createBackupCommand,
  listBackupsQuery,
  verifyBackupCommand,
} from "./application/backup";
export type { FilesystemDeps } from "./application/filesystem";
export { browseFilesystemQuery } from "./application/filesystem";
export type { HealthDeps } from "./application/health";
export { healthQuery } from "./application/health";
export { sweepWorktreesCommand } from "./application/worktree-sweep";

export { createAuditRepository } from "./infrastructure/audit-repositories";
export { sweepOrphanWorktrees, countOrphanWorktrees } from "./infrastructure/worktree-sweep";
