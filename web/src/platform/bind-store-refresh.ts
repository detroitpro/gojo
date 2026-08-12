import { useEffect, useRef } from "react";

/**
 * Register a view refresher on a context store for LiveStoreBridge
 * invalidation, and hydrate once on mount.
 *
 * The bound refresher is read through a ref so callers may pass an unstable
 * `refresh` (e.g. useCallback that churns when soft-loading wrappers change)
 * without re-binding and re-hydrating every render — that loop exhausts the
 * browser with duplicate API calls.
 */
export function useBindStoreRefresh(
  store: {
    bindRefresh: (fn: () => void | Promise<void>) => void;
    unbindRefresh: (fn: () => void | Promise<void>) => void;
  },
  refresh: () => void | Promise<void>,
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const bound = () => refreshRef.current();
    store.bindRefresh(bound);
    void refreshRef.current();
    return () => store.unbindRefresh(bound);
  }, [store]);
}

/** @deprecated name kept for docs — use useBindStoreRefresh */
export const bindStoreRefresh = useBindStoreRefresh;
