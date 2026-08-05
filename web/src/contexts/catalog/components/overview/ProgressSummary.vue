<script setup lang="ts">
import { ref } from "vue";
import { Copy, History, RefreshCw } from "lucide-vue-next";

import AppButton from "@/ui/AppButton.vue";

const props = defineProps<{
  text: string;
  rangeLabel: string;
  derived?: boolean;
  supportingTo?: { name: string; params?: Record<string, string> };
}>();

const emit = defineEmits<{
  regenerate: [];
}>();

const copied = ref(false);

async function copySummary() {
  try {
    await navigator.clipboard.writeText(props.text);
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
  <aside class="progress-summary" aria-labelledby="progress-summary-heading">
    <div class="progress-summary__header">
      <h3 id="progress-summary-heading">Progress summary</h3>
      <span class="muted text-sm">{{ rangeLabel }}</span>
    </div>
    <p class="progress-summary__text">{{ text }}</p>
    <p v-if="derived" class="muted text-sm progress-summary__note">
      Generated from project activity — not an AI narrative.
    </p>
    <div class="toolbar mt-3">
      <AppButton
        size="sm"
        :icon="Copy"
        @click="copySummary()"
      >
        {{ copied ? "Copied" : "Copy summary" }}
      </AppButton>
      <AppButton
        v-if="supportingTo"
        size="sm"
        :icon="History"
        :to="supportingTo"
      >
        View supporting work
      </AppButton>
      <AppButton size="sm" :icon="RefreshCw" @click="emit('regenerate')">
        Refresh summary
      </AppButton>
    </div>
  </aside>
</template>

<style scoped>
.progress-summary {
  margin: 0.25rem 0 1.25rem;
  padding: 0 0 1rem;
  border-bottom: 1px solid var(--border);
}

.progress-summary__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.progress-summary__header h3 {
  margin: 0;
  font-size: 0.95rem;
}

.progress-summary__text {
  margin: 0;
  line-height: 1.55;
  max-width: 52rem;
}

.progress-summary__note {
  margin: 0.4rem 0 0;
}
</style>
