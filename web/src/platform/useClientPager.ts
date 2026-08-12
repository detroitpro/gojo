import { useCallback, useMemo, useState } from "react";

import { rangeLabel as fmtRangeLabel, pageCount as calcPageCount } from "@/kernel/pagination";

export type Order = "asc" | "desc";

export interface UseClientPagerOptions {
  defaultSort?: string;
  defaultOrder?: Order;
}

export function useClientPager<T>(
  items: readonly T[],
  pageSize = 25,
  options: UseClientPagerOptions = {},
) {
  const [page, setPage] = useState(0);
  const [sort, setSortState] = useState(options.defaultSort ?? "");
  const [order, setOrder] = useState<Order>(options.defaultOrder ?? "asc");

  const total = items.length;
  const pageCount = calcPageCount(total, pageSize);
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(() => {
    const start = safePage * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const next = useCallback(
    () => setPage((p) => Math.min(p + 1, pageCount - 1)),
    [pageCount],
  );
  const prev = useCallback(() => setPage((p) => Math.max(p - 1, 0)), []);
  const reset = useCallback(() => setPage(0), []);

  const setSort = useCallback(
    (column: string, firstOrder: Order = "asc") => {
      setSortState((prev) => {
        if (prev === column) {
          setOrder((o) => (o === "asc" ? "desc" : "asc"));
          return prev;
        }
        setOrder(firstOrder);
        return column;
      });
      setPage(0);
    },
    [],
  );

  const offset = safePage * pageSize;
  const rangeLabel = fmtRangeLabel(total, pageSize, offset);

  return {
    page: safePage,
    pageSize,
    pageCount,
    pages: pageCount,
    total,
    items: pageItems,
    pageItems,
    offset,
    next,
    prev,
    setPage,
    canNext: safePage < pageCount - 1,
    canPrev: safePage > 0,
    sort,
    order,
    setSort,
    reset,
    rangeLabel,
  };
}
