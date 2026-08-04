import type { AuthContext } from "@/transports/http/http";
import type { AppContext } from "@/platform/app-context";

import { composeModules, type ComposedModules } from "./composition";

/**
 * Transport-facing composition bag. Use cases receive this instead of raw AppContext
 * so contexts stay behind module builders. Each field surfaces one bounded-context
 * module (see src/contexts/<name>/index.ts).
 */
export type AppRuntime = ComposedModules & {
  ctx: AppContext;
  auth: AuthContext | null;
  /** Kick the run dispatcher after mutations that may unblock the queue. */
  kickDispatcher: () => void;
};

export function createAppRuntime(
  ctx: AppContext,
  options?: { auth?: AuthContext | null },
): AppRuntime {
  const modules = composeModules(ctx);
  return {
    ...modules,
    ctx,
    auth: options?.auth ?? null,
    kickDispatcher: () => ctx.dispatcher.kick(),
  };
}
