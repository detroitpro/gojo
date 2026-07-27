<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  deleteProject,
  getDashboardImpact,
  getProject,
  getProjectDoctor,
  listOpenIntegrations,
  listTasks,
  runTask,
  syncProject,
} from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import {
  formatMergeRate,
  impactCountLabel,
  verificationBadgeClass,
} from "@/lib/impact-format";
import { MAX_PAGE_LIMIT } from "@/lib/pagination";
import { computeProjectHealth, parseManifestView } from "@/lib/project-manifest";
import type {
  DashboardImpact,
  OpenIntegration,
  Project,
  ProjectDoctorResult,
  ProjectSyncResult,
  Task,
} from "@/types";

const route = useRoute();
const router = useRouter();

const project = ref<Project | null>(null);
const doctor = ref<ProjectDoctorResult | null>(null);
const lastSync = ref<ProjectSyncResult | null>(null);
const projectTasks = ref<Task[]>([]);
const openIntegrations = ref<OpenIntegration[]>([]);
const openPrTotal = ref(0);
const mergeBusy = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const removeOpen = ref(false);

type ImpactRange = "30d" | "90d" | "all";
const impact = ref<DashboardImpact | null>(null);
const impactRange = ref<ImpactRange>("30d");
/** Task ids whose impact rows are hidden; empty = all visible. */
const hiddenTaskIds = ref<Set<string>>(new Set());

const projectId = computed(() => route.params.id as string);

function impactFrom(range: ImpactRange): string | undefined {
  if (range === "all") {
    return undefined;
  }
  const days = range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const impactTasks = computed(() => {
  const items = impact.value?.recentItems ?? [];
  const byId = new Map<string, string>();
  for (const item of items) {
    if (!byId.has(item.taskId)) {
      byId.set(item.taskId, item.taskName);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const visibleImpactItems = computed(() => {
  const items = impact.value?.recentItems ?? [];
  if (hiddenTaskIds.value.size === 0) {
    return items;
  }
  return items.filter((item) => !hiddenTaskIds.value.has(item.taskId));
});

function isTaskVisible(taskId: string): boolean {
  return !hiddenTaskIds.value.has(taskId);
}

function toggleTaskVisibility(taskId: string) {
  const next = new Set(hiddenTaskIds.value);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
  }
  hiddenTaskIds.value = next;
}

async function loadImpact() {
  try {
    const from = impactFrom(impactRange.value);
    impact.value = await getDashboardImpact({
      projectId: projectId.value,
      ...(from ? { from } : {}),
    });
    // Drop hide state for tasks no longer present in this range.
    const known = new Set(impactTasks.value.map((task) => task.id));
    const next = new Set([...hiddenTaskIds.value].filter((id) => known.has(id)));
    if (next.size !== hiddenTaskIds.value.size) {
      hiddenTaskIds.value = next;
    }
  } catch {
    impact.value = null;
  }
}

const manifest = computed(() => parseManifestView(project.value?.manifestJson));

const health = computed(() =>
  project.value
    ? computeProjectHealth(project.value, doctor.value)
    : { score: null, level: "missing" as const, label: "…" },
);

const tasksByName = computed(() => {
  const map = new Map<string, Task>();
  for (const task of projectTasks.value) {
    map.set(task.name, task);
  }
  return map;
});

const mergeBabysitter = computed(() =>
  projectTasks.value.find((task) => task.name === "maintain-merge" && task.enabled) ?? null,
);

function prLabel(row: OpenIntegration): string {
  if (row.repo && row.prNumber != null) {
    return `${row.repo}#${row.prNumber}`;
  }
  if (row.prNumber != null) {
    return `#${row.prNumber}`;
  }
  return row.prUrl ?? "Open PR";
}

function scrollToOpenPrs() {
  document.getElementById("open-prs")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadOpenPrs() {
  try {
    const result = await listOpenIntegrations({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: projectId.value,
    });
    openIntegrations.value = result.items;
    openPrTotal.value = result.total;
  } catch {
    openIntegrations.value = [];
    openPrTotal.value = 0;
  }
}

async function runMergeBabysitter() {
  const task = mergeBabysitter.value;
  if (!task) {
    return;
  }
  mergeBusy.value = true;
  error.value = "";
  try {
    const run = await runTask(task.id);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to enqueue merge babysitter";
    mergeBusy.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    project.value = await getProject(projectId.value);
    doctor.value = await getProjectDoctor(projectId.value);
    const tasks = await listTasks({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: projectId.value,
    });
    projectTasks.value = tasks.items;
    await loadOpenPrs();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load project";
    project.value = null;
    doctor.value = null;
    projectTasks.value = [];
    openIntegrations.value = [];
    openPrTotal.value = 0;
  } finally {
    loading.value = false;
    if (route.hash === "#open-prs") {
      requestAnimationFrame(() => scrollToOpenPrs());
    }
  }
}

async function runSync() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await syncProject(project.value.id);
    project.value = result.project;
    lastSync.value = result.sync;
    const path = result.sync.manifestPath
      ? result.sync.manifestPath.split(/[/\\]/).slice(-2).join("/")
      : "no manifest file";
    notice.value = `Synced from ${path} — ${result.sync.agentProfiles} agents, ${result.sync.tasks} tasks, ${result.sync.schedules} schedules`;
    doctor.value = await getProjectDoctor(project.value.id);
    const tasks = await listTasks({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: project.value.id,
    });
    projectTasks.value = tasks.items;
    await loadOpenPrs();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    busy.value = false;
  }
}

async function confirmRemove() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await deleteProject(project.value.id);
    removeOpen.value = false;
    await router.push({ name: "projects" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Remove failed";
    busy.value = false;
  }
}

watch(projectId, () => {
  lastSync.value = null;
  notice.value = "";
  hiddenTaskIds.value = new Set();
  void load();
  void loadImpact();
});

watch(impactRange, () => {
  void loadImpact();
});

watch(
  () => route.hash,
  (hash) => {
    if (hash === "#open-prs" && !loading.value) {
      requestAnimationFrame(() => scrollToOpenPrs());
    }
  },
);

onMounted(() => {
  void load();
  void loadImpact();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <RouterLink :to="{ name: 'projects' }" class="muted text-sm">← Projects</RouterLink>
        <h1 class="mt-2">{{ project?.name ?? "Project" }}</h1>
        <div v-if="project" class="subtitle mono">{{ project.id }}</div>
      </div>
      <div class="toolbar">
        <button
          class="btn btn-sm btn-primary"
          type="button"
          :disabled="busy || !project"
          @click="runSync()"
        >
          Sync
        </button>
        <button
          class="btn btn-sm btn-danger"
          type="button"
          :disabled="busy || !project"
          @click="removeOpen = true"
        >
          Remove
        </button>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" class="alert alert-success">{{ notice }}</div>

    <div v-if="loading && !project" class="empty">Loading…</div>
    <template v-else-if="project">
      <section class="panel mb-7">
        <div class="panel-header">
          Overview
          <span
            class="badge"
            :class="{
              'badge-success': health.level === 'ok',
              'badge-warn': health.level === 'warn',
              'badge-neutral': health.level === 'missing',
            }"
            >{{ health.label }}</span
          >
        </div>
        <div class="panel-body">
          <dl class="project-meta">
            <div>
              <dt>Repository</dt>
              <dd class="mono">{{ project.repoPath }}</dd>
            </div>
            <div>
              <dt>Default branch</dt>
              <dd class="mono">{{ project.defaultBranch }}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>
                {{ project.enabledTaskCount }}/{{ project.taskCount }} tasks ·
                {{ project.enabledScheduleCount }}/{{ project.scheduleCount }} schedules
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd class="mono">{{ new Date(project.updatedAt).toLocaleString() }}</dd>
            </div>
          </dl>

          <div class="toolbar mt-5">
            <RouterLink
              class="btn btn-sm"
              :to="{ name: 'tasks', query: { projectId: project.id } }"
              >Tasks</RouterLink
            >
            <RouterLink
              class="btn btn-sm"
              :to="{ name: 'schedules', query: { projectId: project.id } }"
              >Schedules</RouterLink
            >
            <RouterLink
              class="btn btn-sm"
              :to="{ name: 'runs', query: { projectId: project.id } }"
              >Runs</RouterLink
            >
          </div>
        </div>
      </section>

      <section id="open-prs" class="panel mb-7">
        <div class="panel-header impact-header">
          <span>Open PRs</span>
          <div class="toolbar">
            <button
              v-if="mergeBabysitter && openPrTotal > 0"
              class="btn btn-sm btn-primary"
              type="button"
              :disabled="mergeBusy"
              @click="runMergeBabysitter()"
            >
              {{ mergeBusy ? "Enqueueing…" : "Run merge babysitter" }}
            </button>
            <RouterLink
              v-else-if="openPrTotal > 0"
              class="btn btn-sm"
              :to="{ name: 'tasks', query: { projectId: project.id } }"
            >
              View tasks
            </RouterLink>
          </div>
        </div>
        <div class="panel-body">
          <p class="muted text-sm mb-5">
            Currently open gojo-tracked pull requests (not limited to the Impact date range).
            <template v-if="openPrTotal > 0 && !mergeBabysitter">
              Add an enabled <span class="mono">maintain-merge</span> task to babysit merges from
              here.
            </template>
          </p>
          <div v-if="openIntegrations.length === 0" class="muted text-sm">No open PRs</div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Task</th>
                  <th>Branch</th>
                  <th>Opened</th>
                  <th>Last check</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in openIntegrations" :key="row.runId">
                  <td>
                    <a
                      v-if="row.prUrl && !row.prUrl.startsWith('local://')"
                      :href="row.prUrl"
                      class="entity-name"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ prLabel(row) }}
                    </a>
                    <span v-else class="mono">{{ prLabel(row) }}</span>
                    <div v-if="row.lastError" class="muted text-sm">{{ row.lastError }}</div>
                  </td>
                  <td>
                    <RouterLink
                      v-if="row.taskId"
                      :to="{ name: 'task-detail', params: { id: row.taskId } }"
                      class="entity-name"
                    >
                      {{ row.taskName ?? row.taskId }}
                    </RouterLink>
                    <span v-else class="muted">—</span>
                  </td>
                  <td class="mono muted">{{ row.branchName ?? "—" }}</td>
                  <td class="mono muted">
                    {{ row.openedAt ? new Date(row.openedAt).toLocaleString() : "—" }}
                  </td>
                  <td class="mono muted">
                    {{ row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : "—" }}
                  </td>
                  <td>
                    <RouterLink
                      :to="{ name: 'run-detail', params: { id: row.runId } }"
                      class="btn btn-sm"
                    >
                      Run
                    </RouterLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-if="impact" class="panel mb-7">
        <div class="panel-header impact-header">
          <span>Impact</span>
          <select
            id="project-impact-range"
            v-model="impactRange"
            class="select"
            aria-label="Impact time range"
          >
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">Lifetime</option>
          </select>
        </div>
        <div class="panel-body">
          <div class="stats-row impact-stats">
            <div class="stat">
              <div class="label">Merged</div>
              <div class="value ok">{{ impact.totals.mergedRuns }}</div>
            </div>
            <div class="stat">
              <div class="label">PRs open</div>
              <div class="value">
                <a
                  v-if="openPrTotal > 0 || impact.totals.prsOpen > 0"
                  href="#open-prs"
                  class="entity-name"
                  @click.prevent="scrollToOpenPrs"
                >
                  {{ openPrTotal || impact.totals.prsOpen }}
                </a>
                <template v-else>{{ impact.totals.prsOpen }}</template>
              </div>
            </div>
            <div class="stat">
              <div class="label">Merge rate</div>
              <div class="value">{{ formatMergeRate(impact.totals.mergeRate) }}</div>
            </div>
            <div class="stat">
              <div class="label">Commits</div>
              <div class="value">{{ impact.totals.commits }}</div>
            </div>
            <div class="stat">
              <div class="label">Succeeded runs</div>
              <div class="value">{{ impact.totals.succeededRuns }}</div>
            </div>
          </div>

          <div
            v-if="impact.categories.length > 0"
            class="stats-row impact-stats impact-category-stats"
          >
            <div
              v-for="entry in impact.categories"
              :key="`${entry.category}-${entry.verification}`"
              class="stat"
              :title="`${entry.verification} (trust level)`"
            >
              <div class="label">
                {{ impactCountLabel(entry.category, entry.verification) }}
              </div>
              <div class="value">{{ entry.count }}</div>
            </div>
          </div>
          <div v-else class="muted text-sm impact-empty">
            No impact items recorded in this range
          </div>

          <div v-if="impactTasks.length > 0" class="impact-task-toggles">
            <span class="muted text-sm">Tasks</span>
            <label
              v-for="task in impactTasks"
              :key="task.id"
              class="impact-task-toggle"
            >
              <input
                type="checkbox"
                :checked="isTaskVisible(task.id)"
                @change="toggleTaskVisibility(task.id)"
              />
              {{ task.name }}
            </label>
          </div>

          <div v-if="visibleImpactItems.length > 0" class="table-wrap impact-recent">
            <table class="data">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Subject</th>
                  <th>Summary</th>
                  <th>Trust</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in visibleImpactItems" :key="item.id">
                  <td>
                    <RouterLink
                      :to="{ name: 'run-detail', params: { id: item.runId } }"
                      class="entity-name"
                    >
                      {{ item.taskName }}
                    </RouterLink>
                  </td>
                  <td class="mono">{{ item.subject }}</td>
                  <td>{{ item.summary }}</td>
                  <td>
                    <span class="badge" :class="verificationBadgeClass(item.verification)">
                      {{ item.verification }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-else-if="impact.recentItems.length > 0"
            class="muted text-sm impact-empty"
          >
            All tasks are hidden — turn a task back on to see its impact items
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Sync</div>
        <div class="panel-body">
          <p class="muted">
            Sync reads <span class="mono">gojo.yaml</span> (or
            <span class="mono">.gojo/project.yaml</span>) and upserts agents, tasks, and schedules
            by name. Entries removed from the manifest are soft-disabled so they stop firing.
            Sync does not change git history or your working tree.
          </p>
          <div v-if="lastSync" class="mt-5 project-sync-result">
            <div>
              Manifest:
              <span class="mono">{{ lastSync.manifestPath ?? "not found" }}</span>
            </div>
            <div class="muted mt-2">
              {{ lastSync.agentProfiles }} agents · {{ lastSync.tasks }} tasks ·
              {{ lastSync.schedules }} schedules
            </div>
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Health</div>
        <div class="panel-body">
          <div v-if="!doctor" class="muted">Doctor results unavailable.</div>
          <ul v-else class="health-checklist">
            <li>
              <span :class="doctor.repoExists ? 'ok' : 'bad'">●</span>
              Repository path {{ doctor.repoExists ? "exists" : "is missing" }}
            </li>
            <li>
              <span :class="doctor.manifest ? 'ok' : 'bad'">●</span>
              Manifest file {{ doctor.manifest ? "found" : "not found" }}
            </li>
            <li>
              <span :class="doctor.baseCheckout.clean ? 'ok' : 'bad'">●</span>
              Base checkout
              {{ doctor.baseCheckout.clean ? "is clean" : "has local changes" }}
              <span v-if="doctor.baseCheckout.behindOrigin != null" class="muted">
                · {{ doctor.baseCheckout.behindOrigin }} commit(s) behind origin
              </span>
              <ul
                v-if="doctor.baseCheckout.dirtyFiles.length"
                class="muted mt-2 health-dirty-files"
              >
                <li
                  v-for="file in doctor.baseCheckout.dirtyFiles.slice(0, 12)"
                  :key="file"
                  class="mono"
                >
                  {{ file }}
                </li>
                <li v-if="doctor.baseCheckout.dirtyFiles.length > 12">
                  … +{{ doctor.baseCheckout.dirtyFiles.length - 12 }} more
                </li>
              </ul>
            </li>
            <li v-for="tool in doctor.validationTools" :key="`${tool.task}:${tool.step}:${tool.binary}`">
              <span :class="tool.found ? 'ok' : 'bad'">●</span>
              Validation tool <span class="mono">{{ tool.binary }}</span>
              <template v-if="tool.shellBuiltin"> (shell builtin — ok)</template>
              <template v-else-if="tool.found"> found on daemon PATH</template>
              <template v-else> missing under daemon PATH</template>
              <span class="muted"> — {{ tool.task }} / {{ tool.step }}</span>
            </li>
            <li v-if="doctor.validationTools.length === 0" class="muted">
              No validation tool checks reported
            </li>
          </ul>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Configuration</div>
        <div class="panel-body">
          <div v-if="!project.hasManifest" class="muted">
            No synced manifest yet. Run Sync after adding a
            <span class="mono">gojo.yaml</span>.
          </div>
          <template v-else-if="!manifest.ok">
            <div class="alert alert-error">Could not parse manifest: {{ manifest.error }}</div>
          </template>
          <template v-else>
            <div v-if="Object.keys(manifest.repository).length" class="mb-7">
              <div class="panel-subheader">Repository</div>
              <ul class="project-kv">
                <li v-for="(value, key) in manifest.repository" :key="key">
                  <span class="mono">{{ key }}</span>
                  <span class="muted">{{ String(value) }}</span>
                </li>
              </ul>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Agents ({{ manifest.agents.length }})</div>
              <div v-if="manifest.agents.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Adapter</th>
                      <th>Model</th>
                      <th>Timeout</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="agent in manifest.agents" :key="agent.name">
                      <td class="entity-name">{{ agent.name }}</td>
                      <td class="mono">{{ agent.adapter }}</td>
                      <td class="mono muted">{{ agent.model ?? "—" }}</td>
                      <td class="mono muted">{{ agent.timeout ?? "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Tasks ({{ manifest.tasks.length }})</div>
              <div v-if="manifest.tasks.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Agent</th>
                      <th>Integration</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="task in manifest.tasks" :key="task.name">
                      <td>
                        <RouterLink
                          v-if="tasksByName.get(task.name)"
                          :to="{
                            name: 'task-detail',
                            params: { id: tasksByName.get(task.name)!.id },
                          }"
                          class="entity-name"
                        >
                          {{ task.name }}
                        </RouterLink>
                        <span v-else class="entity-name">{{ task.name }}</span>
                      </td>
                      <td class="mono">{{ task.agent }}</td>
                      <td class="mono">{{ task.integrationMode }}</td>
                      <td class="muted">{{ task.description || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Schedules ({{ manifest.schedules.length }})</div>
              <div v-if="manifest.schedules.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Task</th>
                      <th>Cron</th>
                      <th>Timezone</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="schedule in manifest.schedules" :key="schedule.name">
                      <td class="entity-name">{{ schedule.name }}</td>
                      <td class="mono">{{ schedule.task }}</td>
                      <td class="mono">{{ schedule.cron }}</td>
                      <td class="mono muted">{{ schedule.timezone }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">
                Validation profiles ({{ manifest.validationProfiles.length }})
              </div>
              <div v-if="manifest.validationProfiles.length === 0" class="muted">None</div>
              <ul v-else class="project-kv">
                <li v-for="profile in manifest.validationProfiles" :key="profile.name">
                  <span class="mono">{{ profile.name }}</span>
                  <span class="muted">{{ profile.stepCount }} steps</span>
                </li>
              </ul>
            </div>

            <details class="project-raw-json">
              <summary class="muted">Advanced: raw JSON</summary>
              <pre class="pre-block">{{ manifest.prettyJson }}</pre>
            </details>
          </template>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="removeOpen"
      title="Remove project?"
      confirm-label="Remove project"
      danger
      @close="removeOpen = false"
      @confirm="confirmRemove"
    >
      <p>
        Unregister <strong>{{ project?.name }}</strong> from gojo. Scheduled work for this project
        stops, and gojo’s local history for it is removed.
      </p>
      <p class="muted mt-3">
        This does <strong>not</strong> delete the git repository at
        <span class="mono">{{ project?.repoPath }}</span>.
      </p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.impact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.impact-stats {
  margin-bottom: 0;
}

.impact-category-stats {
  margin-top: 1rem;
}

.impact-empty {
  margin-top: 1rem;
}

.impact-task-toggles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-top: 1rem;
}

.impact-task-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.impact-recent {
  margin-top: 1rem;
}
</style>
