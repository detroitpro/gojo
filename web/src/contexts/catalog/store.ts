import { create } from "zustand";

import { createRefreshRegistry } from "@/platform/create-refresh-store";
import { listProjects } from "./api";
import type { Project } from "./types";

type CatalogState = {
  items: Project[];
  total: number;
  loading: boolean;
  error: string | null;
  load: (opts?: { limit?: number; offset?: number; q?: string }) => Promise<void>;
  bindRefresh: (fn: () => void | Promise<void>) => void;
  unbindRefresh: (fn: () => void | Promise<void>) => void;
  invalidate: (topics?: readonly string[]) => Promise<void>;
};

export const useCatalogStore = create<CatalogState>((set) => {
  const { slice } = createRefreshRegistry();
  return {
    items: [],
    total: 0,
    loading: false,
    error: null,
    ...slice,
    async load(opts) {
      set({ loading: true, error: null });
      try {
        const page = await listProjects(opts);
        set({ items: page.items, total: page.total });
      } catch (caught) {
        set({ error: caught instanceof Error ? caught.message : String(caught) });
      } finally {
        set({ loading: false });
      }
    },
  };
});

/** Alias for LiveStoreBridge / queue compat */
export const useProjectsStore = useCatalogStore;
