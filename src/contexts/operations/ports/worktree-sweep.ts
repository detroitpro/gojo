import type { WorktreeSweepResult } from "../infrastructure/worktree-sweep";

export type { WorktreeSweepResult };

export interface WorktreeSweepPort {
  sweep(): Promise<WorktreeSweepResult>;
}
