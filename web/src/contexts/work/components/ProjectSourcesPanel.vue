<script setup lang="ts">
import type { ProjectSource } from "@/contexts/work/types";
import SyncStateBadge from "@/ui/status/SyncStateBadge.vue";

defineProps<{
  sources: ProjectSource[];
}>();
</script>

<template>
  <div v-if="sources.length > 0" class="source-health mt-5">
    <span
      v-for="source in sources"
      :key="source.id"
      class="source-health__item"
      :title="source.lastError ?? `Observed ${source.observedAt ?? 'never'}`"
    >
      <span class="muted text-sm">{{ source.displayName }}</span>
      <SyncStateBadge :sync-state="source.syncState" :show-label="false" />
    </span>
  </div>
</template>
