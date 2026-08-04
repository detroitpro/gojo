import { onMounted, onUnmounted } from "vue";

/**
 * Register a view refresher on a context Pinia store for LiveStoreBridge
 * invalidation, and hydrate once on mount (replaces former useLiveRefresh
 * immediate:true on the view).
 */
export function bindStoreRefresh(
  store: {
    bindRefresh: (fn: () => void | Promise<void>) => void;
    unbindRefresh: (fn: () => void | Promise<void>) => void;
  },
  refresh: () => void | Promise<void>,
) {
  onMounted(() => {
    store.bindRefresh(refresh);
    void refresh();
  });
  onUnmounted(() => store.unbindRefresh(refresh));
}
