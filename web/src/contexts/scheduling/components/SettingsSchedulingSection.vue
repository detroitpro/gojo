<script setup lang="ts">
import { ref } from "vue";

import {
  getSchedulingPolicy,
  updateSchedulingPolicy,
} from "@/contexts/scheduling/contract";
import AppButton from "@/ui/AppButton.vue";
import { Save } from "lucide-vue-next";
import type { SchedulingPolicy } from "@/contexts/scheduling/types";

const emit = defineEmits<{
  error: [message: string];
  message: [message: string];
}>();

const scheduling = ref<SchedulingPolicy>({
  maxConcurrentRuns: 2,
  maxConcurrentRunsPerProject: 1,
  minStartIntervalMs: 30_000,
  maxLoadPerCpu: 1,
});
const busy = ref(false);

async function load() {
  scheduling.value = await getSchedulingPolicy();
}

async function saveScheduling() {
  busy.value = true;
  try {
    scheduling.value = await updateSchedulingPolicy({
      maxConcurrentRuns: Number(scheduling.value.maxConcurrentRuns),
      maxConcurrentRunsPerProject: Number(scheduling.value.maxConcurrentRunsPerProject),
      minStartIntervalMs: Number(scheduling.value.minStartIntervalMs),
      maxLoadPerCpu: Number(scheduling.value.maxLoadPerCpu),
    });
    emit("message", "Scheduling policy saved");
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to save scheduling policy");
  } finally {
    busy.value = false;
  }
}

defineExpose({ load });
void load();
</script>

<template>
  <section class="panel">
    <div class="panel-header">Run admission</div>
    <div class="panel-body">
      <p class="muted mb-5">
        Cron times are suggestions. The dispatcher admits runs under these caps so projects do
        not stampede the host.
      </p>
      <div class="inline-form">
        <div class="field">
          <label for="sched-max">Max concurrent runs</label>
          <input
            id="sched-max"
            v-model.number="scheduling.maxConcurrentRuns"
            class="input"
            type="number"
            min="1"
          />
        </div>
        <div class="field">
          <label for="sched-per-project">Max per project</label>
          <input
            id="sched-per-project"
            v-model.number="scheduling.maxConcurrentRunsPerProject"
            class="input"
            type="number"
            min="1"
          />
        </div>
        <div class="field">
          <label for="sched-stagger">Stagger (ms)</label>
          <input
            id="sched-stagger"
            v-model.number="scheduling.minStartIntervalMs"
            class="input"
            type="number"
            min="0"
            step="1000"
          />
        </div>
        <div class="field">
          <label for="sched-load">Max load / CPU (0=off)</label>
          <input
            id="sched-load"
            v-model.number="scheduling.maxLoadPerCpu"
            class="input"
            type="number"
            min="0"
            step="0.1"
          />
        </div>
      </div>
      <div class="toolbar mt-5">
        <AppButton
          variant="primary"
          size="sm"
          :icon="Save"
          :loading="busy"
          loading-label="Saving…"
          @click="saveScheduling"
        >
          Save admission policy
        </AppButton>
      </div>
    </div>
  </section>
</template>
