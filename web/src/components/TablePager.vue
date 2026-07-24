<script setup lang="ts">
defineProps<{
  page: number;
  pageCount: number;
  rangeLabel: string;
  total: number;
}>();

const emit = defineEmits<{
  "update:page": [value: number];
}>();
</script>

<template>
  <div v-if="total > 0" class="table-pager">
    <span class="muted">{{ rangeLabel }}</span>
    <div class="table-pager-nav">
      <button
        class="btn btn-sm"
        type="button"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        Prev
      </button>
      <span class="muted">Page {{ page }} / {{ pageCount }}</span>
      <button
        class="btn btn-sm"
        type="button"
        :disabled="page >= pageCount"
        @click="emit('update:page', page + 1)"
      >
        Next
      </button>
    </div>
  </div>
</template>
