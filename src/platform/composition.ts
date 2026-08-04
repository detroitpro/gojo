/**
 * Composition root. Builds every bounded-context module from a single
 * `AppContext`. Transports call this once per request or process; the
 * `AppRuntime` in `./runtime.ts` is a thin wrapper that adds auth.
 *
 * See `docs/architecture/overview.md` — the runtime bag surfaces each module
 * to transports (HTTP router, CLI dispatcher, WebSocket hub).
 *
 * @removal(when: createAppContext is gone or a thin wrapper): promote this file
 * into the sole entry point for building the runtime — removal-backlog R8
 */
import type { AppContext } from "@/platform/app-context";
import { buildAccessModule } from "@/contexts/access";
import { buildCatalogModule } from "@/contexts/catalog";
import { buildDeliveryModule, type DeliveryModule } from "@/contexts/delivery";
import { buildExecutionModule, type ExecutionModule } from "@/contexts/execution";
import {
  buildNotificationsModule,
  type NotificationsModule,
} from "@/contexts/notifications";
import { buildOperationsModule, type OperationsModule } from "@/contexts/operations";
import { buildSchedulingModule } from "@/contexts/scheduling";
import { buildWorkModule, type WorkModule } from "@/contexts/work";
import { PlatformChangeOutbox, SystemClock, type Clock, type Outbox } from "@/kernel";

export interface ComposedModules {
  clock: Clock;
  outbox: Outbox;
  access: ReturnType<typeof buildAccessModule>;
  catalog: ReturnType<typeof buildCatalogModule>;
  scheduling: ReturnType<typeof buildSchedulingModule>;
  execution: ExecutionModule;
  notifications: NotificationsModule;
  operations: OperationsModule;
  delivery: DeliveryModule;
  work: WorkModule;
}

/**
 * Build every context module for a given AppContext. Tests can substitute
 * individual modules by building them directly.
 */
export function composeModules(ctx: AppContext): ComposedModules {
  const clock = new SystemClock();
  const outbox = new PlatformChangeOutbox(ctx.platformEvents);

  return {
    clock,
    outbox,
    access: buildAccessModule({ db: ctx.db }),
    catalog: buildCatalogModule({ ctx, clock, outbox }),
    scheduling: buildSchedulingModule({ db: ctx.db, clock, outbox }),
    execution: buildExecutionModule({ ctx, clock, outbox }),
    notifications: buildNotificationsModule({
      db: ctx.db,
      dispatcher: ctx.notifications,
      clock,
      outbox,
    }),
    operations: buildOperationsModule({ ctx, clock, outbox }),
    delivery: buildDeliveryModule({ ctx }),
    work: buildWorkModule({ ctx, clock, outbox }),
  };
}
