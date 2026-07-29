<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  disableTask,
  enableTask,
  getTask,
  listSchedules,
  runTask,
} from "@/api";
import AppButton from "@/components/AppButton.vue";
import EnabledBadge from "@/components/status/EnabledBadge.vue";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useSoftLoading } from "@/composables/useSoftLoading";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import { Calendar, Play, Power } from "lucide-vue-next";
import type { Schedule, Task } from "@/types";

const route = useRoute();
const router = useRouter();

const task = ref<Task | null>(null);
const schedules = ref<Schedule[]>([]);
const { loading, begin: beginLoad, end: endLoad, reset: resetLoad } = useSoftLoading();
const error = ref("");
const busy = ref(false);

const taskId = computed(() => route.params.id as string);

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw || "—";
  }
}

async function load() {
  const initial = beginLoad();
  error.value = "";
  try {
    task.value = await getTask(taskId.value);
    const sched = await listSchedules({
      taskId: taskId.value,
      enabled: "all",
      limit: 100,
      offset: 0,
    });
    schedules.value = sched.items;
  } catch (err) {
    if (initial) {
      task.value = null;
      schedules.value = [];
    }
    error.value = err instanceof Error ? err.message : "Failed to load task";
  } finally {
    endLoad(initial);
  }
}

async function runNow() {
  if (!task.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const run = await runTask(task.value.id);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start run";
  } finally {
    busy.value = false;
  }
}

async function toggleEnabled() {
  if (!task.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    if (task.value.enabled) {
      await disableTask(task.value.id);
    } else {
      await enableTask(task.value.id);
    }
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update task";
  } finally {
    busy.value = false;
  }
}

watch(taskId, () => {
  resetLoad();
  task.value = null;
  schedules.value = [];
  void load();
});

useLiveRefresh({
  topics: ["tasks", "runs", "schedules"],
  refresh: load,
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <RouterLink :to="{ name: 'tasks' }" class="muted text-sm">← Tasks</RouterLink>
        <h1 class="mt-2">{{ task?.name ?? "Task" }}</h1>
        <div v-if="task?.description" class="subtitle">{{ task.description }}</div>
      </div>
      <div v-if="task" class="toolbar">
        <AppButton
          variant="primary"
          size="sm"
          :icon="Play"
          :loading="busy"
          loading-label="Starting…"
          :disabled="!task.enabled"
          :title="!task.enabled ? 'Task is disabled' : undefined"
          @click="runNow()"
        >
          Run now
        </AppButton>
        <AppButton
          size="sm"
          :icon="Power"
          :loading="busy"
          loading-label="Working…"
          @click="toggleEnabled()"
        >
          {{ task.enabled ? "Disable" : "Enable" }}
        </AppButton>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="loading && !task" class="empty">Loading…</div>
    <template v-else-if="task">
      <section class="panel panel-callout mb-7">
        <div class="panel-header">How to edit</div>
        <div class="panel-body">
          <p class="mb-3">
            Task config is owned by the project manifest — edit YAML (or ask an agent), then Sync.
            This page is for ops inspect and enable/disable only.
          </p>
          <dl class="project-meta">
            <div>
              <dt>Repository</dt>
              <dd class="mono">{{ task.source?.repoPath || "—" }}</dd>
            </div>
            <div>
              <dt>Manifest</dt>
              <dd class="mono">{{ task.source?.manifestPath || "Not in synced manifest" }}</dd>
            </div>
            <div>
              <dt>Prompt file</dt>
              <dd class="mono">
                {{
                  task.source?.promptAbsolutePath ||
                  task.source?.promptFile ||
                  "Not in synced manifest"
                }}
              </dd>
            </div>
          </dl>
          <ol class="task-edit-steps muted mt-5">
            <li>
              Edit the task entry in
              <span class="mono">gojo.yaml</span>
              and its
              <span class="mono">promptFile</span>
              in the repo (or have an agent do it).
            </li>
            <li>
              Open the
              <RouterLink :to="{ name: 'project-detail', params: { id: task.projectId } }"
                >project</RouterLink
              >
              and run
              <strong>Sync</strong>
              so gojo reloads config into the database.
            </li>
            <li>
              Enable/Disable here is ops-only; sync may still soft-disable tasks missing from
              <span class="mono">gojo.yaml</span>.
            </li>
          </ol>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">
          Overview
          <EnabledBadge :enabled="task.enabled" />
        </div>
        <div class="panel-body">
          <dl class="project-meta">
            <div>
              <dt>Project</dt>
              <dd>
                <RouterLink :to="{ name: 'project-detail', params: { id: task.projectId } }">
                  {{ task.projectName || task.projectId }}
                </RouterLink>
              </dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{{ task.agentProfileName || "—" }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd class="mono">{{ new Date(task.createdAt).toLocaleString() }}</dd>
            </div>
            <div>
              <dt>Recent success</dt>
              <dd class="mono">{{ formatRunSuccessRate(task.recentRuns ?? []) }}</dd>
            </div>
          </dl>
          <div class="mt-5">
            <RunHistoryStrip :runs="task.recentRuns ?? []" />
          </div>
          <div class="toolbar mt-5">
            <AppButton
              size="sm"
              :icon="Play"
              :to="{
                name: 'runs',
                query: { taskId: task.id, projectId: task.projectId },
              }"
            >
              View all runs
            </AppButton>
            <AppButton
              size="sm"
              :icon="Calendar"
              :to="{
                name: 'schedules',
                query: { taskId: task.id, projectId: task.projectId, enabled: 'all' },
              }"
            >
              View schedules
            </AppButton>
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Prompt</div>
        <div class="panel-body">
          <p class="muted text-sm mb-3">
            Last-synced snapshot
            <template v-if="task.source?.promptFile">
              from
              <span class="mono">{{ task.source.promptFile }}</span>
            </template>
            . Edit the file in the repo, then Sync.
          </p>
          <pre class="task-prompt-body">{{ task.prompt || "—" }}</pre>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Policy</div>
        <div class="panel-body policy-grid">
          <div>
            <div class="panel-subheader">Validation</div>
            <pre class="task-policy-body">{{ prettyJson(task.validationProfileJson) }}</pre>
          </div>
          <div>
            <div class="panel-subheader">Integration</div>
            <pre class="task-policy-body">{{ prettyJson(task.integrationJson) }}</pre>
          </div>
          <div>
            <div class="panel-subheader">Failure</div>
            <pre class="task-policy-body">{{ prettyJson(task.failurePolicyJson) }}</pre>
          </div>
          <div>
            <div class="panel-subheader">Concurrency</div>
            <pre class="task-policy-body">{{ prettyJson(task.concurrencyJson) }}</pre>
          </div>
        </div>
      </section>

      <section class="list-section">
        <div class="list-section__header">
          <h2 class="list-section__title">Schedules</h2>
          <span class="list-section__meta">{{ schedules.length }}</span>
        </div>
        <div v-if="schedules.length === 0" class="muted">No schedules for this task</div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Cron</th>
                <th>Status</th>
                <th>Next</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="schedule in schedules" :key="schedule.id">
                <td>{{ schedule.name }}</td>
                <td>
                  <div>{{ schedule.cronDescription || schedule.cronExpr }}</div>
                  <div class="mono muted text-sm">{{ schedule.cronExpr }}</div>
                </td>
                <td>
                  <EnabledBadge :enabled="schedule.enabled" />
                </td>
                <td class="mono muted">
                  {{
                    schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "—"
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.task-edit-steps {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: 0.5rem;
}

.task-prompt-body,
.task-policy-body {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  background: var(--bg);
  font-family: var(--mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 28rem;
  overflow: auto;
}

.policy-grid {
  display: grid;
  gap: var(--space-5);
}

@media (min-width: 900px) {
  .policy-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
