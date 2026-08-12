import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  pageCount as calcPageCount,
  rangeLabel as fmtRangeLabel,
  type PaginatedResult,
} from "@/kernel/pagination";
import type { Order } from "@/platform/useClientPager";

export interface UseServerTableOptions<T> {
  pageSize?: number;
  defaultSort?: string;
  defaultOrder?: Order;
  fetchPage: (params: {
    limit: number;
    offset: number;
    sort: string;
    order: Order;
  }) => Promise<PaginatedResult<T>>;
  /** Values whose changes trigger a reload (e.g. filters, query strings). */
  watchSources?: readonly unknown[];
}

export function useServerTable<T>(options: UseServerTableOptions<T>) {
  const pageSize = options.pageSize ?? 25;
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [sort, setSortState] = useState(options.defaultSort ?? "");
  const [order, setOrderState] = useState<Order>(options.defaultOrder ?? "asc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumps when filters change so we reload even if page is already 1. */
  const [filterEpoch, setFilterEpoch] = useState(0);

  const fetchRef = useRef(options.fetchPage);
  fetchRef.current = options.fetchPage;

  const loadGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * pageSize;
      const result = await fetchRef.current({ limit: pageSize, offset, sort, order });
      if (gen !== loadGen.current) return;
      setItems(result.items);
      setTotal(result.total);
    } catch (caught) {
      if (gen !== loadGen.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [page, pageSize, sort, order, filterEpoch]);

  const setSort = useCallback((column: string, firstOrder: Order = "asc") => {
    setSortState((prev) => {
      if (prev === column) {
        setOrderState((o) => (o === "asc" ? "desc" : "asc"));
        return prev;
      }
      setOrderState(firstOrder);
      return column;
    });
    setPageState(1);
  }, []);

  const setPage = useCallback((next: number) => {
    setPageState(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload when the caller's tracked dependencies change (e.g. filters).
  // Always bump filterEpoch after mount — setPage(1) alone is a no-op when
  // already on page 1, which previously left stale rows until live refresh.
  const watchSources = options.watchSources ?? [];
  const filtersReady = useRef(false);
  useEffect(() => {
    setPageState(1);
    if (!filtersReady.current) {
      filtersReady.current = true;
      return;
    }
    setFilterEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, watchSources);

  const pages = calcPageCount(total, pageSize);
  const offset = (page - 1) * pageSize;
  const rangeLabel = fmtRangeLabel(total, pageSize, offset);

  return useMemo(
    () => ({
      items,
      total,
      pages,
      pageSize,
      page,
      offset,
      sort,
      order,
      loading,
      error,
      rangeLabel,
      setSort,
      setPage,
      load,
    }),
    [items, total, pages, pageSize, page, offset, sort, order, loading, error, rangeLabel, setSort, setPage, load],
  );
}
