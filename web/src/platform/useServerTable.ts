import { computed, ref, watch, type WatchSource } from "vue";

import {
  DEFAULT_PAGE_LIMIT,
  pageCount,
  rangeLabel,
  type PaginatedResult,
  type SortOrder,
} from "@/kernel/pagination";

export function useServerTable<T>(options: {
  pageSize?: number;
  watchSources?: WatchSource[];
  /** Debounce ms for refetch when watch sources change (search). Default 200. */
  debounceMs?: number;
  defaultSort?: string;
  defaultOrder?: SortOrder;
  fetchPage: (params: {
    limit: number;
    offset: number;
    sort: string;
    order: SortOrder;
  }) => Promise<PaginatedResult<T>>;
}) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_LIMIT;
  const page = ref(1);
  const items = ref<T[]>([]);
  const total = ref(0);
  const limit = ref(pageSize);
  const offset = ref(0);
  const loading = ref(false);
  const error = ref("");
  const sort = ref(options.defaultSort ?? "createdAt");
  const order = ref<SortOrder>(options.defaultOrder ?? "asc");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  /** After first paint, live refreshes patch rows in place (no loading flash). */
  let painted = false;

  const pages = computed(() => pageCount(total.value, limit.value));
  const label = computed(() => rangeLabel(total.value, limit.value, offset.value));

  async function load() {
    const my = ++seq;
    const initial = !painted;
    if (initial) loading.value = true;
    error.value = "";
    try {
      const nextOffset = (page.value - 1) * pageSize;
      const result = await options.fetchPage({
        limit: pageSize,
        offset: nextOffset,
        sort: sort.value,
        order: order.value,
      });
      if (my !== seq) {
        return;
      }
      items.value = result.items;
      total.value = result.total;
      limit.value = result.limit;
      offset.value = result.offset;
      const maxPage = pageCount(result.total, result.limit);
      if (page.value > maxPage) {
        page.value = maxPage;
      }
      painted = true;
    } catch (err) {
      if (my !== seq) {
        return;
      }
      error.value = err instanceof Error ? err.message : "Failed to load";
      // Keep stale rows on refresh failure so the table does not blank out.
      if (initial) {
        items.value = [];
        total.value = 0;
      }
    } finally {
      if (my === seq && initial) {
        loading.value = false;
      }
    }
  }

  function scheduleLoad(immediate = false) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (immediate) {
      void load();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void load();
    }, options.debounceMs ?? 200);
  }

  function setSort(column: string, firstOrder: SortOrder = "asc") {
    if (sort.value === column) {
      order.value = order.value === "asc" ? "desc" : "asc";
    } else {
      sort.value = column;
      order.value = firstOrder;
    }
    if (page.value !== 1) {
      page.value = 1;
      return;
    }
    scheduleLoad(true);
  }

  watch(page, () => {
    scheduleLoad(true);
  });

  if (options.watchSources?.length) {
    watch(options.watchSources, () => {
      if (page.value !== 1) {
        page.value = 1;
        return;
      }
      scheduleLoad(false);
    });
  }

  return {
    page,
    pages,
    items,
    total,
    limit,
    offset,
    loading,
    error,
    sort,
    order,
    setSort,
    rangeLabel: label,
    reload: () => scheduleLoad(true),
    load,
  };
}
