import { computed, ref, toValue, watch, type MaybeRefOrGetter } from "vue";

import { pageCount, rangeLabel, type SortOrder } from "@/lib/pagination";

function compareValues(a: unknown, b: unknown, order: SortOrder): number {
  const dir = order === "asc" ? 1 : -1;
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (Number(a) - Number(b)) * dir;
  }
  return (
    String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true }) * dir
  );
}

export function useClientPager<T>(
  items: MaybeRefOrGetter<T[]>,
  pageSize: MaybeRefOrGetter<number> = 25,
  options?: {
    defaultSort?: string;
    defaultOrder?: SortOrder;
    /** Map sort key → value extractor. When omitted, sorts by object property. */
    getters?: Record<string, (item: T) => unknown>;
  },
) {
  const page = ref(1);
  const sort = ref(options?.defaultSort ?? "");
  const order = ref<SortOrder>(options?.defaultOrder ?? "asc");

  const sortedItems = computed(() => {
    const all = [...toValue(items)];
    if (!sort.value) {
      return all;
    }
    const key = sort.value;
    const getter = options?.getters?.[key];
    return all.sort((a, b) => {
      const av = getter ? getter(a) : (a as Record<string, unknown>)[key];
      const bv = getter ? getter(b) : (b as Record<string, unknown>)[key];
      return compareValues(av, bv, order.value);
    });
  });

  const total = computed(() => sortedItems.value.length);
  const limit = computed(() => Math.max(1, toValue(pageSize)));
  const pages = computed(() => pageCount(total.value, limit.value));
  const offset = computed(() => (page.value - 1) * limit.value);

  const pageItems = computed(() => {
    const all = sortedItems.value;
    return all.slice(offset.value, offset.value + limit.value);
  });

  const label = computed(() => rangeLabel(total.value, limit.value, offset.value));

  watch(pages, (count) => {
    if (page.value > count) {
      page.value = count;
    }
  });

  function reset() {
    page.value = 1;
  }

  function setSort(column: string, firstOrder: SortOrder = "asc") {
    if (sort.value === column) {
      order.value = order.value === "asc" ? "desc" : "asc";
    } else {
      sort.value = column;
      order.value = firstOrder;
    }
    page.value = 1;
  }

  return {
    page,
    pages,
    pageItems,
    total,
    limit,
    offset,
    sort,
    order,
    setSort,
    rangeLabel: label,
    reset,
  };
}
