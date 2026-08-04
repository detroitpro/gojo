<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "lucide-vue-next";

import AppButton from "@/ui/AppButton.vue";

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
      <AppButton
        size="sm"
        :icon="ChevronLeft"
        :disabled="page <= 1"
        aria-label="Previous page"
        @click="emit('update:page', page - 1)"
      >
        Prev
      </AppButton>
      <span class="muted">Page {{ page }} / {{ pageCount }}</span>
      <AppButton
        size="sm"
        :icon="ChevronRight"
        :disabled="page >= pageCount"
        aria-label="Next page"
        @click="emit('update:page', page + 1)"
      >
        Next
      </AppButton>
    </div>
  </div>
</template>
