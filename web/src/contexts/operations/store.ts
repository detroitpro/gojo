import { create } from "zustand";

import { createRefreshRegistry } from "@/platform/create-refresh-store";
import {
  getDashboard,
  getDashboardImpact,
  getDashboardOverview,
} from "./api";
import type {
  DashboardImpact,
  DashboardOverview,
  DashboardStats,
} from "./types";

type OperationsState = {
  stats: DashboardStats | null;
  overview: DashboardOverview | null;
  impact: DashboardImpact | null;
  loading: boolean;
  error: string | null;
  loadStats: () => Promise<void>;
  loadOverview: () => Promise<void>;
  loadImpact: () => Promise<void>;
  loadAll: () => Promise<void>;
  bindRefresh: (fn: () => void | Promise<void>) => void;
  unbindRefresh: (fn: () => void | Promise<void>) => void;
  invalidate: (topics?: readonly string[]) => Promise<void>;
};

export const useOperationsStore = create<OperationsState>((set, get) => {
  const { slice } = createRefreshRegistry();
  return {
    stats: null,
    overview: null,
    impact: null,
    loading: false,
    error: null,
    ...slice,
    async loadStats() {
      set({ stats: await getDashboard() });
    },
    async loadOverview() {
      set({ overview: await getDashboardOverview() });
    },
    async loadImpact() {
      set({ impact: await getDashboardImpact() });
    },
    async loadAll() {
      set({ loading: true, error: null });
      try {
        await Promise.all([get().loadStats(), get().loadOverview(), get().loadImpact()]);
      } catch (caught) {
        set({ error: caught instanceof Error ? caught.message : String(caught) });
      } finally {
        set({ loading: false });
      }
    },
  };
});

export const useDashboardStore = useOperationsStore;
