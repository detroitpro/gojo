<script setup lang="ts">
import { ref } from "vue";
import { Copy } from "lucide-vue-next";

import type {
  ActivitySummaryMetrics,
  ChangeDayGroup,
} from "@/kernel/project-overview";
import { formatFeedCountsLine } from "@/kernel/project-overview";
import AppButton from "@/ui/AppButton.vue";

import ChangeFeed from "./ChangeFeed.vue";

const props = defineProps<{
  metrics: ActivitySummaryMetrics;
  groups: ChangeDayGroup[];
  impactByRun: Record<string, string[]>;
  digestText: string;
  loading?: boolean;
  error?: string | null;
  emptyMessage: string;
  emptyHint?: string | null;
  projectId: string;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const copied = ref(false);

async function copyDigest() {
  try {
    await navigator.clipboard.writeText(props.digestText);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <section class="recent-activity panel mb-7" aria-labelledby="recent-activity-heading">
    <div class="panel-header recent-activity__header">
      <div class="recent-activity__heading">
        <h2 id="recent-activity-heading">Recent changes</h2>
        <span class="recent-activity__counts">{{ formatFeedCountsLine(metrics) }}</span>
      </div>
      <AppButton
        size="sm"
        variant="ghost"
        :icon="Copy"
        :aria-label="copied ? 'Digest copied' : 'Copy digest'"
        @click="copyDigest()"
      >
        {{ copied ? "Copied" : "Copy" }}
      </AppButton>
    </div>
    <div class="panel-body">
      <ChangeFeed
        :groups="groups"
        :impact-by-run="impactByRun"
        :loading="loading"
        :error="error"
        :empty-message="emptyMessage"
        :empty-hint="emptyHint"
        :project-id="projectId"
        @retry="emit('retry')"
      />
    </div>
  </section>
</template>

<style scoped>
.recent-activity__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.recent-activity__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 0.75rem;
  min-width: 0;
}

.recent-activity__heading h2 {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
}

.recent-activity__counts {
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text-muted);
}
</style>
