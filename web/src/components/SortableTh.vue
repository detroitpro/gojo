<script setup lang="ts">
import type { SortOrder } from "@/lib/pagination";

const props = defineProps<{
  column: string;
  label: string;
  sort: string;
  order: SortOrder;
  /** Preferred order on first click when this column is inactive. */
  defaultOrder?: SortOrder;
}>();

const emit = defineEmits<{
  sort: [column: string, firstOrder: SortOrder];
}>();

const active = () => props.sort === props.column;

const ariaSort = (): "ascending" | "descending" | "none" => {
  if (!active()) {
    return "none";
  }
  return props.order === "asc" ? "ascending" : "descending";
};

const indicator = (): string => {
  if (!active()) {
    return "↕";
  }
  return props.order === "asc" ? "↑" : "↓";
};

function onClick() {
  emit("sort", props.column, props.defaultOrder ?? "asc");
}
</script>

<template>
  <th :aria-sort="ariaSort()" class="sortable-th">
    <button
      type="button"
      class="sortable-th__btn"
      :class="{ 'is-active': active() }"
      @click="onClick"
    >
      <span>{{ label }}</span>
      <span class="sortable-th__ind" aria-hidden="true">{{ indicator() }}</span>
    </button>
  </th>
</template>
