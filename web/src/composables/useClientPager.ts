import { computed, ref, toValue, watch, type MaybeRefOrGetter } from "vue";

import { pageCount, rangeLabel } from "@/lib/pagination";

export function useClientPager<T>(
  items: MaybeRefOrGetter<T[]>,
  pageSize: MaybeRefOrGetter<number> = 25,
) {
  const page = ref(1);

  const total = computed(() => toValue(items).length);
  const limit = computed(() => Math.max(1, toValue(pageSize)));
  const pages = computed(() => pageCount(total.value, limit.value));
  const offset = computed(() => (page.value - 1) * limit.value);

  const pageItems = computed(() => {
    const all = toValue(items);
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

  return {
    page,
    pages,
    pageItems,
    total,
    limit,
    offset,
    rangeLabel: label,
    reset,
  };
}
