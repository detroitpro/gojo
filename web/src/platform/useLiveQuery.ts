/**
 * Legacy live-query helper — prefer useBindStoreRefresh + context APIs.
 * Kept as a thin React hook for any remaining ad-hoc reads.
 */
import { useCallback, useEffect, useState } from "react";

export function useLiveQuery<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
