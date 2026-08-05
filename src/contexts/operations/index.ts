import type { AppContext } from "@/platform/app-context";
import {
  InMemoryUnitOfWork,
  SystemClock,
  type Clock,
  type Outbox,
  type UnitOfWork,
} from "@/kernel";

import { AppContextInstanceStore } from "./infrastructure/app-context-instance-store";
import { AppContextBackupStore } from "./infrastructure/app-context-backup-store";
import { AppContextDashboardReadModel } from "./infrastructure/app-context-dashboard";
import { AppContextDiagnostics } from "./infrastructure/app-context-diagnostics";
import { AppContextWorktreeSweep } from "./infrastructure/app-context-worktree-sweep";
import { BunProcessRunner } from "./infrastructure/bun-process-runner";
import { NativeFilesystemBrowser } from "./infrastructure/native-filesystem-browser";
import {
  createBackupCommand,
  listBackupsQuery,
  verifyBackupCommand,
} from "./application/backup";
import {
  dashboardImpactQuery,
  dashboardOverviewQuery,
  dashboardSummaryQuery,
  queueSnapshotQuery,
} from "./application/dashboard";
import { instanceDoctorQuery } from "./application/diagnostics";
import { browseFilesystemQuery } from "./application/filesystem";
import { healthQuery } from "./application/health";
import {
  getInstanceQuery,
  pauseInstanceCommand,
  resumeInstanceCommand,
  updateInstanceCommand,
} from "./application/instance-config";
import { sweepWorktreesCommand } from "./application/worktree-sweep";
import type { InstanceConfigStore, InstancePatch } from "./ports/instance-config-store";
import type { BackupStore } from "./ports/backup-store";
import type { DashboardReadModel } from "./ports/dashboard-read-model";
import type { DiagnosticsPort } from "./ports/diagnostics";
import type { FilesystemBrowser } from "./ports/filesystem-browser";
import type { ProcessRunner } from "./ports/process-runner";
import type { WorktreeSweepPort } from "./ports/worktree-sweep";

export * from "./contract";

export interface OperationsModule {
  instance: InstanceConfigStore;
  diagnostics: DiagnosticsPort;
  backups: BackupStore;
  filesystem: FilesystemBrowser;
  dashboard: DashboardReadModel;
  processes: ProcessRunner;
  worktrees: WorktreeSweepPort;
  getInstance: () => ReturnType<typeof getInstanceQuery>;
  updateInstance: (input: InstancePatch) => ReturnType<typeof updateInstanceCommand>;
  pauseInstance: () => ReturnType<typeof pauseInstanceCommand>;
  resumeInstance: () => ReturnType<typeof resumeInstanceCommand>;
  instanceDoctor: () => ReturnType<typeof instanceDoctorQuery>;
  sweepWorktrees: () => ReturnType<typeof sweepWorktreesCommand>;
  listBackups: () => ReturnType<typeof listBackupsQuery>;
  createBackup: () => ReturnType<typeof createBackupCommand>;
  verifyBackup: (path: string) => ReturnType<typeof verifyBackupCommand>;
  browse: (path: string | null) => ReturnType<typeof browseFilesystemQuery>;
  dashboardSummary: (compare: string) => ReturnType<typeof dashboardSummaryQuery>;
  dashboardOverview: () => ReturnType<typeof dashboardOverviewQuery>;
  dashboardImpact: (
    input: Parameters<typeof dashboardImpactQuery>[1],
  ) => ReturnType<typeof dashboardImpactQuery>;
  queueSnapshot: (
    input: Parameters<typeof queueSnapshotQuery>[1],
  ) => ReturnType<typeof queueSnapshotQuery>;
  health: () => ReturnType<typeof healthQuery>;
}

export function buildOperationsModule(deps: {
  ctx: AppContext;
  clock?: Clock;
  outbox?: Outbox;
  uow?: UnitOfWork;
  processes?: ProcessRunner;
}): OperationsModule {
  const clock = deps.clock ?? new SystemClock();
  const uow = deps.uow ?? new InMemoryUnitOfWork();
  const instanceStore = new AppContextInstanceStore(deps.ctx);
  const diagnostics = new AppContextDiagnostics(deps.ctx);
  const worktrees = new AppContextWorktreeSweep(deps.ctx);
  const backups = new AppContextBackupStore(deps.ctx);
  const filesystem = new NativeFilesystemBrowser();
  const dashboard = new AppContextDashboardReadModel(deps.ctx);
  const processes = deps.processes ?? new BunProcessRunner();

  async function flushWith<T, E = string>(
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: E }>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: E }> {
    uow.clearEvents();
    const result = await run();
    if (result.ok && deps.outbox) {
      deps.outbox.publish(uow.events());
    }
    uow.clearEvents();
    return result;
  }

  return {
    instance: instanceStore,
    diagnostics,
    backups,
    filesystem,
    dashboard,
    processes,
    worktrees,
    getInstance: () => getInstanceQuery({ store: instanceStore }),
    updateInstance: (input) =>
      flushWith(() => updateInstanceCommand({ store: instanceStore, clock, uow }, input)),
    pauseInstance: () =>
      flushWith(() => pauseInstanceCommand({ store: instanceStore, clock, uow })),
    resumeInstance: () =>
      flushWith(() => resumeInstanceCommand({ store: instanceStore, clock, uow })),
    instanceDoctor: () => instanceDoctorQuery({ diagnostics }),
    sweepWorktrees: () => sweepWorktreesCommand({ sweep: worktrees }),
    listBackups: () => listBackupsQuery({ store: backups }),
    createBackup: () => createBackupCommand({ store: backups }),
    verifyBackup: (path) => verifyBackupCommand({ store: backups }, { path }),
    browse: (path) => browseFilesystemQuery({ browser: filesystem }, { path }),
    dashboardSummary: (compare) => dashboardSummaryQuery({ reads: dashboard }, { compare }),
    dashboardOverview: () => dashboardOverviewQuery({ reads: dashboard }),
    dashboardImpact: (input) => dashboardImpactQuery({ reads: dashboard }, input),
    queueSnapshot: (input) => queueSnapshotQuery({ reads: dashboard }, input),
    health: () => healthQuery({ isPaused: () => deps.ctx.isPaused() }),
  };
}
