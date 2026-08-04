import { defineStore } from "pinia";
import { ref } from "vue";

import { listProjects } from "./api";
import type { Project } from "./types";

export const useCatalogStore = defineStore("catalog", () => {
  const items = ref<Project[]>([]);
  const total = ref(0);
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

  async function load(opts?: { limit?: number; offset?: number; q?: string }) {
    loading.value = true;
    error.value = null;
    try {
      const page = await listProjects(opts);
      items.value = page.items;
      total.value = page.total;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading.value = false;
    }
  }

  return {
    items,
    total,
    loading,
    error,
    load,
    bindRefresh,
    unbindRefresh,
    invalidate,
  };
});

/** @deprecated Use useCatalogStore — kept for LiveStoreBridge / queue compat during migration */
export const useProjectsStore = useCatalogStore;
