<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
import RunActivityFeed from "@/components/RunActivityFeed.vue";
import RunTimelineChart from "@/components/RunTimelineChart.vue";
import StateBadge from "@/components/StateBadge.vue";
import TablePager from "@/components/TablePager.vue";
import { useClientPager } from "@/composables/useClientPager";
import {
  durationBetween,
  fmtCost,
  fmtDuration,
  fmtTime,
  fmtTokens,
  shortSha,
} from "@/lib/format";
import type { PhaseKey } from "@/lib/run-phases";
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
const selectedPhase = ref<PhaseKey | null>(null);
const highlightActivityId = ref<string | null>(null);

const {
  page: attemptPage,
  pages: attemptPages,
  pageItems: attemptItems,
  total: attemptTotal,
  rangeLabel: attemptRange,
} = useClientPager(attempts, 25);

let unsubscribe: (() => void) | null = null;
let durationTick: ReturnType<typeof setInterval> | null = null;

/** Ticks while run is active so header duration re-renders (Date.now is not reactive). */
const nowMs = ref(Date.now());

const runId = computed(() => route.params.id as string);

const TERMINAL_RUN_STATES = new Set([
  "Succeeded",
  "Failed",
  "Canceled",
  "TimedOut",
  "Abandoned",
  "Skipped",
  "Superseded",
  "Blocked",
  "Conflict",
  "InfrastructureFailure",
]);

const runIsActive = computed(() => {
  const state = run.value?.state;
  return Boolean(state && !TERMINAL_RUN_STATES.has(state));
});

function stopDurationTick() {
  if (durationTick !== null) {
    clearInterval(durationTick);
    durationTick = null;
  }
}

function syncDurationTick() {
  if (runIsActive.value) {
    nowMs.value = Date.now();
    if (durationTick === null) {
      durationTick = setInterval(() => {
        nowMs.value = Date.now();
      }, 1000);
    }
    return;
  }
  stopDurationTick();
}

watch(runIsActive, syncDurationTick, { immediate: true });

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

const artifactsValidationText = computed(() => {
  if (!artifacts.value?.validation) {
    return null;
  }
  try {
    return JSON.stringify(artifacts.value.validation, null, 2);
  } catch {
    return String(artifacts.value.validation);
  }
});

interface HandoffAssetView {
  role: string;
  label: string;
  path?: string;
  mediaType: string;
  content?: string;
}

const handoffAssets = computed((): HandoffAssetView[] => {
  const handoff = artifacts.value?.handoff;
  if (!handoff || typeof handoff !== "object") {
    return [];
  }
  const raw = (handoff as { assets?: unknown }).assets;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: HandoffAssetView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.role !== "string") {
      continue;
    }
    out.push({
      role: obj.role,
      label:
        typeof obj.label === "string" && obj.label.trim()
          ? obj.label.trim()
          : obj.role,
      ...(typeof obj.path === "string" ? { path: obj.path } : {}),
      mediaType:
        typeof obj.mediaType === "string" && obj.mediaType.trim()
          ? obj.mediaType.trim()
          : "text/markdown",
      ...(typeof obj.content === "string" ? { content: obj.content } : {}),
    });
  }
  return out;
});

const runDurationMs = computed(() => {
  const start = run.value?.startedAt ?? run.value?.createdAt;
  if (!start) {
    return null;
  }
  if (run.value?.finishedAt) {
    return durationBetween(start, run.value.finishedAt);
  }
  // Subscribe to nowMs so the header clock advances during long Running phases.
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) {
    return null;
  }
  return Math.max(0, nowMs.value - startMs);
});

const costSummary = computed(() => {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let hasCost = false;
  let source: string | null = null;
  let model: string | null = null;

  for (const attempt of attempts.value) {
    input += attempt.inputTokens ?? 0;
    output += attempt.outputTokens ?? 0;
    cacheRead += attempt.cacheReadTokens ?? 0;
    cacheWrite += attempt.cacheWriteTokens ?? 0;
    if (attempt.totalCostUsd != null) {
      cost += attempt.totalCostUsd;
      hasCost = true;
      source = attempt.costSource ?? source;
    }
    if (attempt.model) {
      model = attempt.model;
    }
  }

  // Live model from SSE (available at agent start).
  for (const event of events.value) {
    if (event.type === "run.agent.model" && event.data && typeof event.data === "object") {
      const m = (event.data as { model?: string }).model;
      if (m) {
        model = m;
      }
    }
  }

  // Tokens/cost from agent.finished before attempts reload.
  for (const event of events.value) {
    if (event.type !== "run.agent.finished" || !event.data || typeof event.data !== "object") {
      continue;
    }
    const usage = (event.data as { usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      totalCostUsd?: number | null;
      costSource?: string;
      model?: string;
    } | null }).usage;
    if (!usage) {
      continue;
    }
    if (!hasCost) {
      input = usage.inputTokens ?? input;
      output = usage.outputTokens ?? output;
      cacheRead = usage.cacheReadTokens ?? cacheRead;
      cacheWrite = usage.cacheWriteTokens ?? cacheWrite;
      if (usage.totalCostUsd != null) {
        cost = usage.totalCostUsd;
        hasCost = true;
        source = usage.costSource ?? source;
      }
    }
    if (usage.model) {
      model = usage.model;
    }
  }

  const runActive = run.value
    ? !["Succeeded", "Failed", "Canceled", "TimedOut", "Abandoned"].includes(run.value.state)
    : false;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost: hasCost ? cost : null,
    source,
    model,
    pendingUsage: runActive && !hasCost,
  };
});

const canCancel = computed(() =>
  run.value
    ? !["Succeeded", "Failed", "Canceled", "TimedOut", "Abandoned"].includes(run.value.state)
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
  events.value = [];
  unsubscribe = subscribeRunEvents(runId.value, (event) => {
    if (event.id != null && events.value.some((e) => e.id === event.id)) {
      return;
    }
    events.value = [...events.value, event];

    if (event.type === "run.state_changed" && run.value && event.data && typeof event.data === "object") {
      const data = event.data as { to?: string };
      if (data.to) {
        const next: Run = { ...run.value, state: data.to as Run["state"] };
        // Seed startedAt from first transition into Preparing/Running if missing.
        if (
          !next.startedAt &&
          (data.to === "Preparing" || data.to === "Running")
        ) {
          next.startedAt = event.at || new Date().toISOString();
        }
        run.value = next;
      }
    }

    if (event.type === "run.failed" && run.value && event.data && typeof event.data === "object") {
      const data = event.data as { error?: string };
      run.value = {
        ...run.value,
        state: "Failed",
        errorMessage: data.error ?? run.value.errorMessage,
      };
    }

    if (event.type === "run.agent.model" && event.data && typeof event.data === "object") {
      const model = (event.data as { model?: string }).model;
      const latest = attempts.value.at(-1);
      if (model && latest && !latest.model) {
        attempts.value = attempts.value.map((a, i) =>
          i === attempts.value.length - 1 ? { ...a, model } : a,
        );
      }
    }

    if (event.type === "run.agent.finished") {
      void load();
    }

    if (event.type === "run.finished") {
      if (run.value) {
        const data =
          event.data && typeof event.data === "object"
            ? (event.data as { state?: string })
            : {};
        run.value = {
          ...run.value,
          ...(data.state ? { state: data.state as Run["state"] } : {}),
          finishedAt: event.at || new Date().toISOString(),
        };
      }
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

function attemptDuration(attempt: Attempt): string {
  return fmtDuration(durationBetween(attempt.startedAt, attempt.finishedAt));
}

onMounted(async () => {
  await load();
  startEvents();
  void loadInspect();
});

onUnmounted(() => {
  unsubscribe?.();
  stopDurationTick();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>{{ run?.taskName || `Run ${runId.slice(0, 14)}…` }}</h1>
        <div v-if="run" class="subtitle run-meta">
          <StateBadge :state="run.state" />
          <span class="muted">{{ run.projectName || "Unknown project" }}</span>
          <span class="muted">·</span>
          <span class="muted">{{ run.trigger }}</span>
          <span class="muted">·</span>
          <span class="mono muted">{{ fmtDuration(runDurationMs) }}</span>
          <span v-if="run.startedAt" class="muted">
            · started {{ fmtTime(run.startedAt) }}
          </span>
          <span class="muted">·</span>
          <span class="mono muted" :title="run.id">{{ run.id.slice(0, 12) }}…</span>
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
      <div v-if="run.errorMessage" class="alert alert-error mb-4">
        {{ run.errorMessage }}
      </div>

      <section class="panel cost-panel">
        <div class="panel-header">Cost &amp; usage</div>
        <div class="panel-body cost-grid">
          <div>
            <div class="cost-label">Cost</div>
            <div class="cost-value mono">
              {{ fmtCost(costSummary.cost, costSummary.source) }}
            </div>
            <div class="muted cost-hint">
              {{
                costSummary.source === "reported"
                  ? "Reported by agent CLI"
                  : costSummary.source === "estimated"
                    ? "Estimated from tokens × model rates"
                    : costSummary.pendingUsage
                      ? "Tokens/cost finalize when the agent finishes"
                      : "No usage reported yet"
              }}
            </div>
          </div>
          <div>
            <div class="cost-label">Tokens</div>
            <div class="cost-value mono">
              {{ fmtTokens(costSummary.input) }} in · {{ fmtTokens(costSummary.output) }} out
            </div>
            <div class="muted cost-hint">
              <template v-if="costSummary.pendingUsage">Pending until agent finishes</template>
              <template v-else>
                cache r/w {{ fmtTokens(costSummary.cacheRead) }} /
                {{ fmtTokens(costSummary.cacheWrite) }}
              </template>
            </div>
          </div>
          <div>
            <div class="cost-label">Model</div>
            <div class="cost-value mono">{{ costSummary.model ?? "—" }}</div>
          </div>
        </div>
      </section>

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
          <RunTimelineChart
            :events="events"
            :selected-phase="selectedPhase"
            @select-phase="selectedPhase = $event"
            @select-activity="highlightActivityId = $event"
          />
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          Activity
          <button
            v-if="selectedPhase"
            class="btn btn-sm"
            type="button"
            @click="selectedPhase = null"
          >
            Clear phase filter
          </button>
        </div>
        <div class="panel-body">
          <RunActivityFeed
            :events="events"
            :phase-filter="selectedPhase"
            :highlight-id="highlightActivityId"
          />
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

            <div v-if="handoffAssets.length" class="mt-4">
              <div class="panel-subheader">Handoff assets</div>
              <ul class="handoff-assets">
                <li v-for="(asset, idx) in handoffAssets" :key="`${asset.role}-${idx}`">
                  <div class="handoff-asset-meta">
                    <span class="mono">{{ asset.role }}</span>
                    <span class="muted">· {{ asset.label }}</span>
                    <span v-if="asset.path" class="mono muted"> · {{ asset.path }}</span>
                  </div>
                  <pre
                    v-if="asset.content"
                    class="pre-block mt-2 activity-assistant-body"
                    >{{ asset.content }}</pre
                  >
                </li>
              </ul>
            </div>

            <pre v-if="artifactsHandoffText" class="pre-block mt-4">{{
              artifactsHandoffText
            }}</pre>
            <div v-else class="muted mt-4">No handoff.json on disk</div>
            <pre v-if="artifactsValidationText" class="pre-block mt-4">{{
              artifactsValidationText
            }}</pre>
            <div v-else-if="run?.errorMessage?.startsWith('Validation failed')" class="muted mt-4">
              No validation.json on disk
            </div>
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
                <th>Duration</th>
                <th>Cost</th>
                <th>Tokens</th>
                <th>Model</th>
                <th>Start</th>
                <th>Result</th>
                <th>Branch</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attempt in attemptItems" :key="attempt.id">
                <td class="mono">{{ attempt.attemptNumber }}</td>
                <td class="mono">{{ attempt.state }}</td>
                <td class="mono">{{ attempt.exitCode ?? "—" }}</td>
                <td class="mono muted">{{ attemptDuration(attempt) }}</td>
                <td class="mono">{{ fmtCost(attempt.totalCostUsd, attempt.costSource) }}</td>
                <td class="mono muted">
                  {{ fmtTokens(attempt.inputTokens) }}/{{ fmtTokens(attempt.outputTokens) }}
                </td>
                <td class="mono muted">{{ attempt.model ?? "—" }}</td>
                <td class="mono muted" :title="attempt.startingCommit ?? undefined">
                  {{ shortSha(attempt.startingCommit) }}
                </td>
                <td class="mono muted" :title="attempt.resultCommit ?? undefined">
                  {{ shortSha(attempt.resultCommit) }}
                </td>
                <td class="mono muted">{{ attempt.branchName ?? "—" }}</td>
              </tr>
            </tbody>
          </table>
          <TablePager
            v-model:page="attemptPage"
            :page-count="attemptPages"
            :range-label="attemptRange"
            :total="attemptTotal"
          />
        </div>
      </section>
    </template>
  </div>
</template>
