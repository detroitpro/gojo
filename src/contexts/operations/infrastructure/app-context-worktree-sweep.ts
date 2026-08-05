import type { AppContext } from "@/platform/app-context";

import type { WorktreeSweepPort } from "../ports/worktree-sweep";
import { sweepOrphanWorktrees, type WorktreeSweepResult } from "./worktree-sweep";

export class AppContextWorktreeSweep implements WorktreeSweepPort {
  constructor(private readonly ctx: AppContext) {}

  async sweep(): Promise<WorktreeSweepResult> {
    return sweepOrphanWorktrees({
      worktreesRoot: this.ctx.paths.worktrees,
      repos: this.ctx.repos,
    });
  }
}
