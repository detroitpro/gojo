<script setup lang="ts">
/**
 * Single host for platform-event → Pinia store invalidation.
 * One hub subscription routes each topic to at most one invalidate path
 * (avoids the N× overlapping useLiveRefresh storm from the W5 bridge).
 */
import { onScopeDispose } from "vue";

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

const scheduling = useSchedulingStore();
const operations = useOperationsStore();
const catalog = useCatalogStore();
const execution = useExecutionStore();
const delivery = useDeliveryStore();
const work = useWorkStore();
const notifications = useNotificationsStore();
const access = useAccessStore();

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

/** Topic → store keys. No overlaps: each topic maps to a unique set. */
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
  // work/sources must NOT invalidate catalog — that reloaded Schedules/Projects on every work event
  work: ["work", "delivery"],
  sources: ["work"],
};

const storeInvalidate: Record<string, () => void | Promise<void>> = {
  scheduling: () => scheduling.invalidate(),
  operations: () => operations.invalidate(),
  catalog: () => catalog.invalidate(),
  execution: () => execution.invalidate(),
  delivery: () => delivery.invalidate(),
  work: () => work.invalidate(),
  notifications: () => notifications.invalidate(),
  access: () => access.invalidate(),
};

let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingStores = new Set<string>();
let inFlight: Promise<void> | null = null;
let queued = false;

async function flush(): Promise<void> {
  if (inFlight) {
    queued = true;
    return inFlight;
  }
  const labels = [...pendingStores];
  pendingStores.clear();
  if (labels.length === 0) return;

  inFlight = Promise.all(labels.map((name) => Promise.resolve(storeInvalidate[name]?.())))
    .then(() => undefined)
    .catch(() => {
      // Views own visible error state.
    })
    .finally(() => {
      inFlight = null;
      if (queued) {
        queued = false;
        void flush();
      }
    });
  return inFlight;
}

function scheduleStores(names: readonly string[]): void {
  for (const name of names) pendingStores.add(name);
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
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

let previousStatus: string | null = null;
const unsubscribeStatus = platformEventHub.subscribeStatus((status) => {
  // Skip the immediate replay from subscribeStatus; only react to transitions.
  if (
    previousStatus !== null &&
    (status === "degraded" || (status === "connected" && previousStatus === "degraded"))
  ) {
    scheduleStores(Object.keys(storeInvalidate));
  }
  previousStatus = status;
});

onScopeDispose(() => {
  unsubscribe();
  unsubscribeStatus();
  if (coalesceTimer) clearTimeout(coalesceTimer);
});
</script>

<template>
  <!-- headless bridge -->
</template>
