import { defineStore } from "pinia";
import { ref } from "vue";

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

export const useOperationsStore = defineStore("operations", () => {
  const stats = ref<DashboardStats | null>(null);
  const overview = ref<DashboardOverview | null>(null);
  const impact = ref<DashboardImpact | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

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

  async function loadStats() {
    stats.value = await getDashboard();
  }

  async function loadOverview() {
    overview.value = await getDashboardOverview();
  }

  async function loadImpact() {
    impact.value = await getDashboardImpact();
  }

  async function loadAll() {
    loading.value = true;
    error.value = null;
    try {
      await Promise.all([loadStats(), loadOverview(), loadImpact()]);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading.value = false;
    }
  }

  return {
    stats,
    overview,
    impact,
    loading,
    error,
    loadStats,
    loadOverview,
    loadImpact,
    loadAll,
    bindRefresh,
    unbindRefresh,
    invalidate,
  };
});

/** @deprecated Use useOperationsStore */
export const useDashboardStore = useOperationsStore;
