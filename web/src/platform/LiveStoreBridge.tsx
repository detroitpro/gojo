import { useEffect, useRef } from "react";

import type { PlatformEventTopic } from "@gojo/contracts/types";
import { useAccessStore } from "@/contexts/access/contract";
import { useCatalogStore } from "@/contexts/catalog/contract";
import { useDeliveryStore } from "@/contexts/delivery/contract";
import { useExecutionStore } from "@/contexts/execution/contract";
import { useNotificationsStore } from "@/contexts/notifications/contract";
import { useOperationsStore } from "@/contexts/operations/contract";
import { useSchedulingStore } from "@/contexts/scheduling/contract";
import { useWorkStore } from "@/contexts/work/contract";
import { platformEventHub } from "@/infrastructure/platform-events";

const ALL_TOPICS = [
  "queue",
  "dashboard",
  "overview",
  "impact",
  "runs",
  "projects",
  "agents",
  "schedules",
  "work",
  "sources",
] as const satisfies readonly PlatformEventTopic[];

const TOPIC_STORES: Record<
  (typeof ALL_TOPICS)[number],
  ReadonlyArray<
    | "scheduling"
    | "operations"
    | "catalog"
    | "execution"
    | "delivery"
    | "work"
    | "notifications"
    | "access"
  >
> = {
  queue: ["scheduling"],
  dashboard: ["operations", "notifications", "access"],
  overview: ["operations"],
  impact: ["operations", "catalog"],
  runs: ["execution", "operations", "delivery"],
  projects: ["catalog"],
  agents: ["catalog"],
  schedules: ["catalog"],
  work: ["work", "delivery"],
  sources: ["work"],
};

/**
 * Single host for platform-event → Zustand store invalidation.
 */
export function LiveStoreBridge() {
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStores = useRef(new Set<string>());
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const previousStatus = useRef<string | null>(null);

  useEffect(() => {
    const storeInvalidate: Record<string, () => void | Promise<void>> = {
      scheduling: () => useSchedulingStore.getState().invalidate(),
      operations: () => useOperationsStore.getState().invalidate(),
      catalog: () => useCatalogStore.getState().invalidate(),
      execution: () => useExecutionStore.getState().invalidate(),
      delivery: () => useDeliveryStore.getState().invalidate(),
      work: () => useWorkStore.getState().invalidate(),
      notifications: () => useNotificationsStore.getState().invalidate(),
      access: () => useAccessStore.getState().invalidate(),
    };

    async function flush(): Promise<void> {
      if (inFlight.current) {
        queued.current = true;
        return inFlight.current;
      }
      const labels = [...pendingStores.current];
      pendingStores.current.clear();
      if (labels.length === 0) return;

      inFlight.current = Promise.all(
        labels.map((name) => Promise.resolve(storeInvalidate[name]?.())),
      )
        .then(() => undefined)
        .catch(() => {
          /* Views own visible error state. */
        })
        .finally(() => {
          inFlight.current = null;
          if (queued.current) {
            queued.current = false;
            void flush();
          }
        });
      return inFlight.current;
    }

    function scheduleStores(names: readonly string[]): void {
      for (const name of names) pendingStores.current.add(name);
      if (coalesceTimer.current) clearTimeout(coalesceTimer.current);
      coalesceTimer.current = setTimeout(() => {
        coalesceTimer.current = null;
        void flush();
      }, 100);
    }

    const unsubscribe = platformEventHub.subscribe(ALL_TOPICS, (event) => {
      const stores = new Set<string>();
      for (const topic of event.topics) {
        const targets = TOPIC_STORES[topic as (typeof ALL_TOPICS)[number]];
        if (!targets) continue;
        for (const name of targets) stores.add(name);
      }
      if (stores.size === 0) return;
      scheduleStores([...stores]);
    });

    const unsubscribeStatus = platformEventHub.subscribeStatus((status) => {
      if (
        previousStatus.current !== null &&
        (status === "degraded" ||
          (status === "connected" && previousStatus.current === "degraded"))
      ) {
        scheduleStores(Object.keys(storeInvalidate));
      }
      previousStatus.current = status;
    });

    return () => {
      unsubscribe();
      unsubscribeStatus();
      if (coalesceTimer.current) clearTimeout(coalesceTimer.current);
    };
  }, []);

  return null;
}
