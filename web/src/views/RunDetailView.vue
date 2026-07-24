<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  approveRun,
  cancelRun,
  getRun,
  getRunArtifacts,
  getRunDiff,
  rejectRun,
  retryRun,
  subscribeRunEvents,
} from "@/api";
import StateBadge from "@/components/StateBadge.vue";
import type { Attempt, Run, RunArtifactsResult, RunEvent } from "@/types";

const route = useRoute();
const router = useRouter();

const run = ref<Run | null>(null);
const attempts = ref<Attempt[]>([]);
const events = ref<RunEvent[]>([]);
const loading = ref(true);
const error = ref("");
const busy = ref(false);
const rejectReason = ref("");
const diffFiles = ref<string[] | null>(null);
const artifacts = ref<RunArtifactsResult | null>(null);
const inspectBusy = ref(false);

let unsubscribe: (() => void) | null = null;

const runId = computed(() => route.params.id as string);

const handoffText = computed(() => {
  const latest = attempts.value.at(-1);
  if (!latest?.handoffJson) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(latest.handoffJson), null, 2);
  } catch {
    return latest.handoffJson;
  }
});

const artifactsHandoffText = computed(() => {
  if (!artifacts.value?.handoff) {
    return null;
  }
  try {
    return JSON.stringify(artifacts.value.handoff, null, 2);
  } catch {
    return String(artifacts.value.handoff);
  }
});

const canCancel = computed(() =>
  run.value
    ? !["Succeeded", "Failed", "Canceled", "TimedOut"].includes(run.value.state)
    : false,
);

const canApprove = computed(() => run.value?.state === "AwaitingApproval");

const canRetry = computed(() =>
  run.value
    ? ["Failed", "Canceled", "TimedOut", "InfrastructureFailure", "Conflict"].includes(
        run.value.state,
      )
    : false,
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await getRun(runId.value);
    run.value = data.run;
    attempts.value = data.attempts;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load run";
  } finally {
    loading.value = false;
  }
}

async function loadInspect() {
  inspectBusy.value = true;
  try {
    const [diff, arts] = await Promise.all([
      getRunDiff(runId.value).catch(() => ({ files: [] as string[] })),
      getRunArtifacts(runId.value),
    ]);
    diffFiles.value = diff.files;
    artifacts.value = arts;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load inspect data";
  } finally {
    inspectBusy.value = false;
  }
}

function startEvents() {
  unsubscribe?.();
  unsubscribe = subscribeRunEvents(runId.value, (event) => {
    events.value = [...events.value, event];
    if (event.type === "run.state_changed" && run.value && typeof event.payload === "object") {
      const payload = event.payload as { state?: string };
      if (payload.state) {
        run.value = { ...run.value, state: payload.state as Run["state"] };
      }
    }
    if (event.type === "run.finished") {
      void load();
      void loadInspect();
    }
  });
}

async function doCancel() {
  busy.value = true;
  try {
    run.value = await cancelRun(runId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Cancel failed";
  } finally {
    busy.value = false;
  }
}

async function doApprove() {
  busy.value = true;
  try {
    run.value = await approveRun(runId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Approve failed";
  } finally {
    busy.value = false;
  }
}

async function doReject() {
  busy.value = true;
  try {
    run.value = await rejectRun(runId.value, rejectReason.value || undefined);
    rejectReason.value = "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Reject failed";
  } finally {
    busy.value = false;
  }
}

async function doRetry() {
  busy.value = true;
  error.value = "";
  try {
    const next = await retryRun(runId.value);
    await router.push(`/runs/${next.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Retry failed";
  } finally {
    busy.value = false;
  }
}

function fmtTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

onMounted(async () => {
  await load();
  startEvents();
  void loadInspect();
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Run {{ runId.slice(0, 14) }}…</h1>
        <div v-if="run" class="subtitle">
          <StateBadge :state="run.state" />
          <span class="muted ml-3">{{ run.trigger }}</span>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-sm" type="button" @click="router.push('/runs')">Back</button>
        <button class="btn btn-sm" type="button" @click="load">Refresh</button>
        <button v-if="canCancel" class="btn btn-sm btn-danger" type="button" :disabled="busy" @click="doCancel">
          Cancel
        </button>
        <button v-if="canApprove" class="btn btn-sm btn-primary" type="button" :disabled="busy" @click="doApprove">
          Approve
        </button>
        <button v-if="canRetry" class="btn btn-sm" type="button" :disabled="busy" @click="doRetry">
          Retry
        </button>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Loading…</div>

    <template v-else-if="run">
      <div v-if="canApprove" class="panel">
        <div class="panel-header">Approval required</div>
        <div class="panel-body">
          <div class="inline-form">
            <div class="field flex-2">
              <label for="reason">Reject reason (optional)</label>
              <input id="reason" v-model="rejectReason" placeholder="Policy violation…" />
            </div>
            <button class="btn btn-danger" type="button" :disabled="busy" @click="doReject">Reject</button>
          </div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">Timeline</div>
        <div class="panel-body">
          <ul v-if="events.length" class="timeline">
            <li v-for="(event, idx) in events" :key="idx">
              <span class="time">{{ fmtTime(event.timestamp) }}</span>
              <span>
                <span class="mono">{{ event.type }}</span>
                <pre v-if="event.payload" class="pre-block mt-2">{{
                  JSON.stringify(event.payload, null, 2)
                }}</pre>
              </span>
            </li>
          </ul>
          <div v-else class="muted">Waiting for events… (live SSE)</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          Diff
          <button class="btn btn-sm" type="button" :disabled="inspectBusy" @click="loadInspect">
            Refresh
          </button>
        </div>
        <div class="panel-body">
          <div v-if="diffFiles === null" class="muted">Loading…</div>
          <div v-else-if="diffFiles.length === 0" class="muted">No changed files (or workspace unavailable)</div>
          <ul v-else class="mono">
            <li v-for="file in diffFiles" :key="file">{{ file }}</li>
          </ul>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Artifacts</div>
        <div class="panel-body">
          <div v-if="!artifacts" class="muted">Loading…</div>
          <template v-else>
            <div class="mono">
              path={{ artifacts.path }}
              <br />
              exists={{ artifacts.exists }}
            </div>
            <pre v-if="artifactsHandoffText" class="pre-block mt-4">{{
              artifactsHandoffText
            }}</pre>
            <div v-else class="muted mt-4">No handoff.json on disk</div>
          </template>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Handoff JSON</div>
        <div class="panel-body">
          <pre v-if="handoffText" class="pre-block">{{ handoffText }}</pre>
          <div v-else class="muted">No handoff payload yet</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Attempts</div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>#</th>
                <th>State</th>
                <th>Exit</th>
                <th>Branch</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attempt in attempts" :key="attempt.id">
                <td class="mono">{{ attempt.attemptNumber }}</td>
                <td class="mono">{{ attempt.state }}</td>
                <td class="mono">{{ attempt.exitCode ?? "—" }}</td>
                <td class="mono muted">{{ attempt.branchName ?? "—" }}</td>
                <td class="mono muted">{{ fmtTime(attempt.startedAt) }}</td>
                <td class="mono muted">{{ fmtTime(attempt.finishedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="run.errorMessage" class="panel">
        <div class="panel-header">Error</div>
        <div class="panel-body">
          <pre class="pre-block">{{ run.errorMessage }}</pre>
        </div>
      </section>
    </template>
  </div>
</template>
