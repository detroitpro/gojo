<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  GitPullRequest,
} from "lucide-vue-next";

import type { CompletedWorkPresentation } from "@/kernel/project-overview";
import AppButton from "@/ui/AppButton.vue";
import UiIcon from "@/ui/UiIcon.vue";

const props = defineProps<{
  item: CompletedWorkPresentation;
}>();

const expanded = ref(false);

const absoluteTime = computed(() =>
  props.item.completedAt ? new Date(props.item.completedAt).toLocaleString() : "",
);
</script>

<template>
  <article class="completed-work-item">
    <header class="completed-work-item__header">
      <button
        type="button"
        class="completed-work-item__toggle"
        :aria-expanded="expanded"
        :aria-controls="`completed-details-${item.id}`"
        @click="expanded = !expanded"
      >
        <UiIcon :icon="expanded ? ChevronDown : ChevronRight" :size="16" aria-hidden="true" />
        <span class="sr-only">{{ expanded ? "Collapse" : "Expand" }} details</span>
      </button>
      <span class="completed-work-item__status" :title="item.statusLabel">
        <UiIcon :icon="CheckCircle2" :size="18" class="tone-success" aria-hidden="true" />
        <span class="sr-only">{{ item.statusLabel }}</span>
      </span>
      <div class="completed-work-item__titles">
        <h3 class="completed-work-item__title">{{ item.outcomeTitle }}</h3>
        <p v-if="item.description" class="completed-work-item__desc muted">
          {{ item.description }}
        </p>
      </div>
    </header>

    <div class="completed-work-item__meta muted text-sm">
      <span>Agent: {{ item.agentLabel }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ item.statusLabel }}</span>
      <template v-if="item.deliveryRefs.length">
        <span aria-hidden="true">·</span>
        <span>{{ item.deliveryRefs.join(" · ") }}</span>
      </template>
      <span aria-hidden="true">·</span>
      <time :datetime="item.completedAt ?? undefined" :title="absoluteTime">
        {{ item.completedRelative }}
      </time>
    </div>

    <div v-if="item.followUp" class="completed-work-item__followup text-sm">
      Follow-up: {{ item.followUp }}
    </div>

    <div class="completed-work-item__actions">
      <AppButton
        v-if="item.runId"
        size="sm"
        :icon="Eye"
        :to="{ name: 'run-detail', params: { id: item.runId } }"
      >
        View details
      </AppButton>
      <AppButton
        v-if="item.externalUrl"
        size="sm"
        :icon="item.kind === 'pull-request' ? GitPullRequest : ExternalLink"
        :href="item.externalUrl"
        target="_blank"
      >
        {{ item.kind === "pull-request" ? "Open pull request" : "Open in source" }}
      </AppButton>
    </div>

    <div
      v-show="expanded"
      :id="`completed-details-${item.id}`"
      class="completed-work-item__details muted text-sm"
    >
      <dl class="completed-work-item__dl">
        <div>
          <dt>Kind</dt>
          <dd>{{ item.kind }}</dd>
        </div>
        <div v-if="item.runId">
          <dt>Run</dt>
          <dd class="mono">{{ item.runId }}</dd>
        </div>
        <div v-if="item.completedAt">
          <dt>Completed</dt>
          <dd>{{ absoluteTime }}</dd>
        </div>
      </dl>
    </div>
  </article>
</template>

<style scoped>
.completed-work-item {
  padding: 1rem 0;
  border-bottom: 1px solid var(--border);
}

.completed-work-item:last-child {
  border-bottom: 0;
}

.completed-work-item__header {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.completed-work-item__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.15rem;
  padding: 0.15rem;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.completed-work-item__toggle:focus-visible {
  outline: 2px solid var(--focus, var(--accent));
  outline-offset: 2px;
}

.completed-work-item__status {
  display: inline-flex;
  margin-top: 0.15rem;
  color: var(--success, #3ecf8e);
}

.completed-work-item__titles {
  min-width: 0;
  flex: 1;
}

.completed-work-item__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.35;
}

.completed-work-item__desc {
  margin: 0.35rem 0 0;
  line-height: 1.45;
}

.completed-work-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  margin-top: 0.55rem;
  padding-left: 2.5rem;
}

.completed-work-item__followup {
  margin-top: 0.4rem;
  padding-left: 2.5rem;
  color: var(--warn, #e3b341);
}

.completed-work-item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.65rem;
  padding-left: 2.5rem;
}

.completed-work-item__details {
  margin-top: 0.75rem;
  padding: 0.75rem 0 0 2.5rem;
}

.completed-work-item__dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.completed-work-item__dl dt {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.completed-work-item__dl dd {
  margin: 0.2rem 0 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
