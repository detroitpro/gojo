import { create } from "zustand";

import { createRefreshRegistry } from "@/platform/create-refresh-store";
import { getQueue } from "./api";
import type { QueueRunningItem, QueueWaitingItem, SchedulingPolicy } from "./types";

type SchedulingState = {
  policy: SchedulingPolicy | null;
  running: QueueRunningItem[];
  waiting: QueueWaitingItem[];
  counts: { running: number; waiting: number };
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  error: string | null;
  sort: string;
  order: "asc" | "desc";
  load: (opts?: {
    limit?: number;
    offset?: number;
    sort?: string;
    order?: "asc" | "desc";
  }) => Promise<void>;
  bindRefresh: (fn: () => void | Promise<void>) => void;
  unbindRefresh: (fn: () => void | Promise<void>) => void;
  invalidate: (topics?: readonly string[]) => Promise<void>;
};

export const useSchedulingStore = create<SchedulingState>((set, get) => {
  const { slice } = createRefreshRegistry();
  return {
    policy: null,
    running: [],
    waiting: [],
    counts: { running: 0, waiting: 0 },
    total: 0,
    limit: 25,
    offset: 0,
    loading: false,
    error: null,
    sort: "position",
    order: "asc",
    ...slice,
    async load(opts) {
      set({ loading: true, error: null });
      try {
        const state = get();
        const nextLimit = opts?.limit ?? state.limit;
        const nextOffset = opts?.offset ?? state.offset;
        const nextSort = opts?.sort ?? state.sort;
        const nextOrder = opts?.order ?? state.order;
        const snap = await getQueue({
          limit: nextLimit,
          offset: nextOffset,
          sort: nextSort,
          order: nextOrder,
        });
        set({
          policy: snap.policy,
          running: snap.running,
          waiting: snap.waiting,
          counts: snap.counts,
          total: snap.total,
          limit: snap.limit,
          offset: snap.offset,
          sort: nextSort,
          order: nextOrder,
        });
      } catch (caught) {
        set({ error: caught instanceof Error ? caught.message : String(caught) });
      } finally {
        set({ loading: false });
      }
    },
  };
});

export const useQueueStore = useSchedulingStore;
