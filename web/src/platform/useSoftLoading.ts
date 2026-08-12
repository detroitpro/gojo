import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Full-page loading only for the first successful paint (or after reset).
 * Live refreshes / polling must patch in place — never tear down the tree.
 * Non-React factory used by unit tests and any non-hook callers.
 */
export function createSoftLoading(initialLoading = true): {
  loading: { value: boolean };
  begin: () => boolean;
  end: (wasInitial: boolean) => void;
  reset: () => void;
} {
  const loading = { value: initialLoading };
  let painted = false;

  return {
    loading,
    begin() {
      const wasInitial = !painted;
      if (wasInitial) loading.value = true;
      return wasInitial;
    },
    end(wasInitial: boolean) {
      if (wasInitial) loading.value = false;
      painted = true;
    },
    reset() {
      painted = false;
      loading.value = true;
    },
  };
}

/**
 * React soft-loading: only show loading chrome when there is no existing data.
 * Live refreshes keep prior content visible.
 *
 * `run` is referentially stable. Prefer depending on `soft.run` (not the whole
 * return object) inside useCallback deps.
 */
export function useSoftLoading(hasData: boolean): {
  loading: boolean;
  soft: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const [loading, setLoading] = useState(false);
  const hasDataRef = useRef(hasData);
  hasDataRef.current = hasData;

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const soft = hasDataRef.current;
    if (!soft) setLoading(true);
    try {
      return await fn();
    } finally {
      if (!soft) setLoading(false);
    }
  }, []);

  return useMemo(
    () => ({ loading, soft: hasData, run }),
    [loading, hasData, run],
  );
}
