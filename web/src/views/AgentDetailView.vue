<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  disableAgent,
  enableAgent,
  getAgent,
  listSchedules,
  runAgent,
} from "@/api";
import AppButton from "@/components/AppButton.vue";
import EnabledBadge from "@/components/status/EnabledBadge.vue";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useSoftLoading } from "@/composables/useSoftLoading";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import { Calendar, Play, Power } from "lucide-vue-next";
import type { Agent, Schedule } from "@/types";

const route = useRoute();
const router = useRouter();

const agent = ref<Agent | null>(null);
const schedules = ref<Schedule[]>([]);
const { loading, begin: beginLoad, end: endLoad, reset: resetLoad } = useSoftLoading();
const error = ref("");
const busy = ref(false);

const agentId = computed(() => route.params.id as string);

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
    agent.value = await getAgent(agentId.value);
    const sched = await listSchedules({
      agentId: agentId.value,
      enabled: "all",
      limit: 100,
      offset: 0,
    });
    schedules.value = sched.items;
  } catch (err) {
    if (initial) {
      agent.value = null;
      schedules.value = [];
    }
    error.value = err instanceof Error ? err.message : "Failed to load agent";
  } finally {
    endLoad(initial);
  }
}

async function runNow() {
  if (!agent.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const run = await runAgent(agent.value.id);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start run";
  } finally {
    busy.value = false;
  }
}

async function toggleEnabled() {
  if (!agent.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    if (agent.value.enabled) {
      await disableAgent(agent.value.id);
    } else {
      await enableAgent(agent.value.id);
    }
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update agent";
  } finally {
    busy.value = false;
  }
}

watch(agentId, () => {
  resetLoad();
  agent.value = null;
  schedules.value = [];
  void load();
});

useLiveRefresh({
  topics: ["agents", "runs", "schedules"],
  refresh: load,
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <RouterLink :to="{ name: 'agents' }" class="muted text-sm">← Agents</RouterLink>
        <h1 class="mt-2">{{ agent?.name ?? "Agent" }}</h1>
        <div v-if="agent?.description" class="subtitle">{{ agent.description }}</div>
      </div>
      <div v-if="agent" class="toolbar">
        <AppButton
          variant="primary"
          size="sm"
          :icon="Play"
          :loading="busy"
          loading-label="Starting…"
          :disabled="!agent.enabled"
          :title="!agent.enabled ? 'Agent is disabled' : undefined"
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
          {{ agent.enabled ? "Disable" : "Enable" }}
        </AppButton>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="loading && !agent" class="empty">Loading…</div>
    <template v-else-if="agent">
      <section class="panel panel-callout mb-7">
        <div class="panel-header">How to edit</div>
        <div class="panel-body">
          <p class="mb-3">
            Agent config is owned by the project manifest — edit YAML (or ask an agent), then Sync.
            This page is for ops inspect and enable/disable only.
          </p>
          <dl class="project-meta">
            <div>
              <dt>Repository</dt>
              <dd class="mono">{{ agent.source?.repoPath || "—" }}</dd>
            </div>
            <div>
              <dt>Manifest</dt>
              <dd class="mono">{{ agent.source?.manifestPath || "Not in synced manifest" }}</dd>
            </div>
            <div>
              <dt>Prompt file</dt>
              <dd class="mono">
                {{
                  agent.source?.promptAbsolutePath ||
                  agent.source?.promptFile ||
                  "Not in synced manifest"
                }}
              </dd>
            </div>
          </dl>
          <ol class="task-edit-steps muted mt-5">
            <li>
              Edit the agent entry in
              <span class="mono">gojo.yaml</span>
              and its
              <span class="mono">promptFile</span>
              in the repo (or have an agent do it).
            </li>
            <li>
              Open the
              <RouterLink :to="{ name: 'project-detail', params: { id: agent.projectId } }"
                >project</RouterLink
              >
              and run
              <strong>Sync</strong>
              so gojo reloads config into the database.
            </li>
            <li>
              Enable/Disable here is ops-only; sync may still soft-disable agents missing from
              <span class="mono">gojo.yaml</span>.
            </li>
          </ol>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">
          Overview
          <EnabledBadge :enabled="agent.enabled" />
        </div>
        <div class="panel-body">
          <dl class="project-meta">
            <div>
              <dt>Project</dt>
              <dd>
                <RouterLink :to="{ name: 'project-detail', params: { id: agent.projectId } }">
                  {{ agent.projectName || agent.projectId }}
                </RouterLink>
              </dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{{ agent.profileName || "—" }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd class="mono">{{ new Date(agent.createdAt).toLocaleString() }}</dd>
            </div>
            <div>
              <dt>Recent success</dt>
              <dd class="mono">{{ formatRunSuccessRate(agent.recentRuns ?? []) }}</dd>
            </div>
          </dl>
          <div class="mt-5">
            <RunHistoryStrip :runs="agent.recentRuns ?? []" />
          </div>
          <div class="toolbar mt-5">
            <AppButton
              size="sm"
              :icon="Play"
              :to="{
                name: 'runs',
                query: { agentId: agent.id, projectId: agent.projectId },
              }"
            >
              View all runs
            </AppButton>
            <AppButton
              size="sm"
              :icon="Calendar"
              :to="{
                name: 'schedules',
                query: { agentId: agent.id, projectId: agent.projectId, enabled: 'all' },
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
            <template v-if="agent.source?.promptFile">
              from
              <span class="mono">{{ agent.source.promptFile }}</span>
            </template>
            . Edit the file in the repo, then Sync.
          </p>
          <pre class="task-prompt-body">{{ agent.prompt || "—" }}</pre>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Policy</div>
        <div class="panel-body policy-grid">
          <div>
            <div class="panel-subheader">Validation</div>
            <pre class="task-policy-body">{{ prettyJson(agent.validationProfileJson) }}</pre>
          </div>
          <div>
            <div class="panel-subheader">Integration</div>
            <pre class="task-policy-body">{{ prettyJson(agent.integrationJson) }}</pre>
          </div>
          <div>
            <div class="panel-subheader">Failure</div>
            <pre class="task-policy-body">{{ prettyJson(agent.failurePolicyJson) }}</pre>
          </div>
          <div>
            <div class="panel-subheader">Concurrency</div>
            <pre class="task-policy-body">{{ prettyJson(agent.concurrencyJson) }}</pre>
          </div>
        </div>
      </section>

      <section class="list-section">
        <div class="list-section__header">
          <h2 class="list-section__title">Schedules</h2>
          <span class="list-section__meta">{{ schedules.length }}</span>
        </div>
        <div v-if="schedules.length === 0" class="muted">No schedules for this agent</div>
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
