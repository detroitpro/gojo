import { defineStore } from "pinia";
import { ref } from "vue";

import { getQueue } from "./api";
import type { QueueRunningItem, QueueWaitingItem, SchedulingPolicy } from "./types";

export const useSchedulingStore = defineStore("scheduling", () => {
  const policy = ref<SchedulingPolicy | null>(null);
  const running = ref<QueueRunningItem[]>([]);
  const waiting = ref<QueueWaitingItem[]>([]);
  const counts = ref({ running: 0, waiting: 0 });
  const total = ref(0);
  const limit = ref(25);
  const offset = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const sort = ref("position");
  const order = ref<"asc" | "desc">("asc");

  const refreshers = new Set<() => void | Promise<void>>();

  function bindRefresh(fn: () => void | Promise<void>) {
    refreshers.add(fn);
  }

  function unbindRefresh(fn: () => void | Promise<void>) {
    refreshers.delete(fn);
  }

  async function invalidate(_topics?: readonly string[]) {
    await Promise.all([...refreshers].map((fn) => Promise.resolve(fn())));
  }

  async function load(opts?: {
    limit?: number;
    offset?: number;
    sort?: string;
    order?: "asc" | "desc";
  }) {
    loading.value = true;
    error.value = null;
    try {
      const nextLimit = opts?.limit ?? limit.value;
      const nextOffset = opts?.offset ?? offset.value;
      const nextSort = opts?.sort ?? sort.value;
      const nextOrder = opts?.order ?? order.value;
      const snap = await getQueue({
        limit: nextLimit,
        offset: nextOffset,
        sort: nextSort,
        order: nextOrder,
      });
      policy.value = snap.policy;
      running.value = snap.running;
      waiting.value = snap.waiting;
      counts.value = snap.counts;
      total.value = snap.total;
      limit.value = snap.limit;
      offset.value = snap.offset;
      sort.value = nextSort;
      order.value = nextOrder;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading.value = false;
    }
  }

  return {
    policy,
    running,
    waiting,
    counts,
    total,
    limit,
    offset,
    loading,
    error,
    sort,
    order,
    load,
    bindRefresh,
    unbindRefresh,
    invalidate,
  };
});

/** @deprecated Use useSchedulingStore */
export const useQueueStore = useSchedulingStore;
