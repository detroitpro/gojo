/**
 * Shared invalidate/bindRefresh registry used by every context Zustand store.
 * LiveStoreBridge invalidates; views hydrate via bindStoreRefresh.
 */
export type RefreshStoreSlice = {
  bindRefresh: (fn: () => void | Promise<void>) => void;
  unbindRefresh: (fn: () => void | Promise<void>) => void;
  invalidate: (topics?: readonly string[]) => Promise<void>;
};

export function createRefreshRegistry(): {
  refreshers: Set<() => void | Promise<void>>;
  slice: RefreshStoreSlice;
} {
  const refreshers = new Set<() => void | Promise<void>>();
  return {
    refreshers,
    slice: {
      bindRefresh(fn) {
        refreshers.add(fn);
      },
      unbindRefresh(fn) {
        refreshers.delete(fn);
      },
      async invalidate(_topics?: readonly string[]) {
        await Promise.all([...refreshers].map((fn) => Promise.resolve(fn())));
      },
    },
  };
}
