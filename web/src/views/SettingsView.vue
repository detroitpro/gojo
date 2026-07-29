<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import {
  createApiToken,
  createBackup,
  getHealth,
  getInstance,
  getInstanceDoctor,
  getSchedulingPolicy,
  listApiTokens,
  listBackups,
  listNotificationChannels,
  pauseInstance,
  resumeInstance,
  revokeApiToken,
  updateInstance,
  updateSchedulingPolicy,
  verifyBackup,
} from "@/api";
import AppButton from "@/components/AppButton.vue";
import StatGrid from "@/components/StatGrid.vue";
import StatTile from "@/components/StatTile.vue";
import NotificationChannelsPanel from "@/components/NotificationChannelsPanel.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useClientPager } from "@/composables/useClientPager";
import { useServerTable } from "@/composables/useServerTable";
import {
  HardDrive,
  KeyRound,
  Pause,
  Play,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-vue-next";
import type {
  HealthInfo,
  InstanceDoctorResult,
  InstanceInfo,
  NotificationChannelMap,
  SchedulingPolicy,
} from "@/types";

const instance = ref<InstanceInfo | null>(null);
const health = ref<HealthInfo | null>(null);
const doctor = ref<InstanceDoctorResult | null>(null);
const channels = ref<NotificationChannelMap>({});
const tokenName = ref("");
const createdToken = ref<string | null>(null);
const loading = ref(true);
const error = ref("");
const busy = ref(false);
const message = ref("");
const tokenQuery = ref("");
const backupQuery = ref("");
const doctorQuery = ref("");
const scheduling = ref<SchedulingPolicy>({
  maxConcurrentRuns: 2,
  maxConcurrentRunsPerProject: 1,
  minStartIntervalMs: 30_000,
  maxLoadPerCpu: 1,
});

const daemonPathSummary = computed(() => {
  const path = doctor.value?.daemonPath?.trim() ?? "";
  if (!path) {
    return null;
  }
  const entries = path.split(":").filter(Boolean);
  const bunPath = doctor.value?.tools?.find((tool) => tool.name === "bun")?.path;
  const bunDir = bunPath?.replace(/\/[^/]+$/, "") ?? "";
  const hasBunBin =
    entries.some((entry) => entry.includes("/.bun/bin") || entry.endsWith(".bun/bin")) ||
    (bunDir.length > 0 && entries.includes(bunDir));
  return { entryCount: entries.length, hasBunBin };
});

const filteredDoctorAgents = computed(() => {
  const agents = doctor.value?.agents ?? [];
  const q = doctorQuery.value.trim().toLowerCase();
  if (!q) {
    return agents;
  }
  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(q) ||
      (agent.version?.toLowerCase().includes(q) ?? false),
  );
});

const {
  page: tokenPage,
  pages: tokenPages,
  items: tokenItems,
  total: tokenTotal,
  sort: tokenSort,
  order: tokenOrder,
  setSort: setTokenSort,
  rangeLabel: tokenRange,
  load: loadTokens,
  error: tokenError,
} = useServerTable({
  defaultSort: "createdAt",
  defaultOrder: "desc",
  watchSources: [tokenQuery],
  fetchPage: ({ limit, offset, sort, order }) =>
    listApiTokens({
      limit,
      offset,
      sort,
      order,
      q: tokenQuery.value || undefined,
    }),
});

const {
  page: backupPage,
  pages: backupPages,
  items: backupItems,
  total: backupTotal,
  sort: backupSort,
  order: backupOrder,
  setSort: setBackupSort,
  rangeLabel: backupRange,
  load: loadBackups,
  error: backupError,
} = useServerTable({
  defaultSort: "createdAt",
  defaultOrder: "desc",
  watchSources: [backupQuery],
  fetchPage: ({ limit, offset, sort, order }) =>
    listBackups({
      limit,
      offset,
      sort,
      order,
      q: backupQuery.value || undefined,
    }),
});

const {
  page: doctorPage,
  pages: doctorPages,
  pageItems: doctorItems,
  total: doctorTotal,
  sort: doctorSort,
  order: doctorOrder,
  setSort: setDoctorSort,
  rangeLabel: doctorRange,
  reset: resetDoctorPage,
} = useClientPager(filteredDoctorAgents, 25, {
  defaultSort: "name",
  defaultOrder: "asc",
});

watch(doctorQuery, () => resetDoctorPage());

async function load() {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    const [inst, h, channelMap, doc, policy] = await Promise.all([
      getInstance(),
      getHealth(),
      listNotificationChannels(),
      getInstanceDoctor(),
      getSchedulingPolicy(),
    ]);
    instance.value = inst;
    health.value = h;
    channels.value = channelMap;
    doctor.value = doc;
    scheduling.value = policy;
    await Promise.all([loadTokens(), loadBackups()]);
    if (tokenError.value) {
      error.value = tokenError.value;
    } else if (backupError.value) {
      error.value = backupError.value;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load settings";
  } finally {
    loading.value = false;
  }
}

async function saveScheduling() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    scheduling.value = await updateSchedulingPolicy({
      maxConcurrentRuns: Number(scheduling.value.maxConcurrentRuns),
      maxConcurrentRunsPerProject: Number(scheduling.value.maxConcurrentRunsPerProject),
      minStartIntervalMs: Number(scheduling.value.minStartIntervalMs),
      maxLoadPerCpu: Number(scheduling.value.maxLoadPerCpu),
    });
    message.value = "Scheduling policy saved";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to save scheduling policy";
  } finally {
    busy.value = false;
  }
}

async function togglePause() {
  if (!instance.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    if (instance.value.paused) {
      await resumeInstance();
    } else {
      await pauseInstance();
    }
    instance.value = await getInstance();
    health.value = await getHealth();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update pause state";
  } finally {
    busy.value = false;
  }
}

async function toggleTelemetry() {
  if (!instance.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    instance.value = await updateInstance({
      telemetryEnabled: !instance.value.telemetryEnabled,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update telemetry";
  } finally {
    busy.value = false;
  }
}

async function createToken() {
  if (!tokenName.value.trim()) {
    return;
  }
  busy.value = true;
  error.value = "";
  createdToken.value = null;
  try {
    const created = await createApiToken(tokenName.value.trim());
    createdToken.value = created.token;
    tokenName.value = "";
    await loadTokens();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to create token";
  } finally {
    busy.value = false;
  }
}

async function revokeToken(id: string) {
  if (!confirm("Revoke this API token?")) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await revokeApiToken(id);
    await loadTokens();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to revoke token";
  } finally {
    busy.value = false;
  }
}

async function doCreateBackup() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await createBackup();
    message.value = `Backup created: ${result.path}`;
    await loadBackups();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Backup failed";
  } finally {
    busy.value = false;
  }
}

async function doVerify(path: string) {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await verifyBackup(path);
    message.value = result.valid ? `Valid: ${result.path}` : `Invalid: ${result.path}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Verify failed";
  } finally {
    busy.value = false;
  }
}

async function refreshDoctor() {
  busy.value = true;
  error.value = "";
  try {
    doctor.value = await getInstanceDoctor();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Doctor failed";
  } finally {
    busy.value = false;
  }
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function onChannelError(msg: string) {
  error.value = msg;
  message.value = "";
}

function onChannelMessage(msg: string) {
  message.value = msg;
  error.value = "";
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Settings</h1>
        <div class="subtitle">Instance configuration</div>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="message" class="alert alert-info">{{ message }}</div>
    <div v-if="loading" class="empty">Loading…</div>

    <template v-else-if="instance">
      <StatGrid>
        <StatTile metric-key="settings.version" :value="health?.version ?? '—'" />
        <StatTile
          metric-key="settings.scheduler"
          :value="instance.paused ? 'Paused' : 'Active'"
        />
        <StatTile
          metric-key="settings.telemetry"
          :value="instance.telemetryEnabled ? 'On' : 'Off'"
        />
      </StatGrid>

      <section class="panel">
        <div class="panel-header">Instance</div>
        <div class="panel-body">
          <p class="mono">{{ instance.bindHost }}:{{ instance.bindPort }}</p>
          <p class="muted mt-4">
            Bind address is configured in instance.yaml. Remote access should run behind HTTPS, a
            reverse proxy, or VPN.
          </p>
          <div class="toolbar mt-5">
            <AppButton
              size="sm"
              :icon="instance.paused ? Play : Pause"
              :loading="busy"
              loading-label="Working…"
              @click="togglePause"
            >
              {{ instance.paused ? "Resume scheduler" : "Pause scheduler" }}
            </AppButton>
            <AppButton
              size="sm"
              :icon="Power"
              :loading="busy"
              loading-label="Working…"
              @click="toggleTelemetry"
            >
              {{ instance.telemetryEnabled ? "Disable telemetry" : "Enable telemetry" }}
            </AppButton>
          </div>
          <div class="mono muted mt-5">
            health status={{ health?.status ?? "unknown" }} paused={{ String(health?.paused) }}
          </div>
        </div>
      </section>

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

      <section class="panel">
        <div class="panel-header">
          Diagnostics
          <AppButton
            size="sm"
            :icon="RefreshCw"
            :loading="busy"
            loading-label="Working…"
            @click="refreshDoctor"
          >
            Re-run
          </AppButton>
        </div>
        <div class="panel-body">
          <div v-if="!doctor" class="muted">No diagnostics yet</div>
          <template v-else>
            <div class="mono">
              git=<span :class="doctor.git ? 'ok' : 'bad'">{{ doctor.git }}</span>
              disk=<span :class="doctor.disk ? 'ok' : 'bad'">{{ doctor.disk }}</span>
              database=<span :class="doctor.database ? 'ok' : 'bad'">{{ doctor.database }}</span>
              binary=<span :class="doctor.binaryStale ? 'bad' : 'ok'">{{
                doctor.binaryStale ? "stale" : "current"
              }}</span>
            </div>
            <div
              v-for="(warning, idx) in doctor.warnings ?? []"
              :key="`doc-warn-${idx}`"
              class="alert alert-error mt-3"
            >
              {{ warning }}
            </div>
            <div class="mono muted mt-3">home={{ doctor.home }}</div>
            <div v-if="doctor.tools?.length" class="mt-5">
              <div class="muted">Tools (daemon PATH)</div>
              <ul class="mt-2">
                <li v-for="tool in doctor.tools" :key="tool.name" class="mono">
                  <span :class="tool.found ? 'ok' : 'bad'">{{ tool.name }}</span>
                  <span class="muted"> — {{ tool.found ? tool.path ?? "found" : "missing" }}</span>
                </li>
              </ul>
            </div>
            <details v-if="daemonPathSummary" class="daemon-path mt-5">
              <summary class="muted">
                Daemon PATH — {{ daemonPathSummary.entryCount }} entries
                <span :class="daemonPathSummary.hasBunBin ? 'ok' : 'bad'">
                  · ~/.bun/bin {{ daemonPathSummary.hasBunBin ? "present" : "missing" }}
                </span>
              </summary>
              <pre class="daemon-path-body mono muted">{{ doctor.daemonPath }}</pre>
            </details>
            <div class="inline-form mt-5 task-filters">
              <div class="field flex-2">
                <label for="doctor-agent-search">Search agents</label>
                <input
                  id="doctor-agent-search"
                  v-model="doctorQuery"
                  class="input"
                  type="search"
                  placeholder="Adapter name…"
                />
              </div>
            </div>
            <div class="table-wrap mt-5">
              <table class="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="name"
                      label="Agent"
                      :sort="doctorSort"
                      :order="doctorOrder"
                      @sort="setDoctorSort"
                    />
                    <SortableTh
                      column="installed"
                      label="Installed"
                      :sort="doctorSort"
                      :order="doctorOrder"
                      default-order="desc"
                      @sort="setDoctorSort"
                    />
                    <SortableTh
                      column="version"
                      label="Version"
                      :sort="doctorSort"
                      :order="doctorOrder"
                      @sort="setDoctorSort"
                    />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="agent in doctorItems" :key="agent.name">
                    <td class="mono">{{ agent.name }}</td>
                    <td>{{ agent.installed ? "yes" : "no" }}</td>
                    <td class="mono muted">{{ agent.version ?? "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <TablePager
              v-model:page="doctorPage"
              :page-count="doctorPages"
              :range-label="doctorRange"
              :total="doctorTotal"
            />
          </template>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Authentication — API tokens</div>
        <div class="panel-body">
          <form class="inline-form" @submit.prevent="createToken">
            <div class="field">
              <label for="token-name">Token name</label>
              <input id="token-name" v-model="tokenName" placeholder="ci-bot" required />
            </div>
            <AppButton
              variant="primary"
              :icon="KeyRound"
              type="submit"
              :loading="busy"
              loading-label="Creating…"
              :disabled="!tokenName.trim()"
            >
              Create token
            </AppButton>
          </form>
          <div v-if="createdToken" class="alert alert-info mt-5">
            Copy this token now; it will not be shown again.
            <pre class="pre-block mt-3">{{ createdToken }}</pre>
          </div>
          <div class="inline-form mt-5 task-filters">
            <div class="field flex-2">
              <label for="token-search">Search</label>
              <input
                id="token-search"
                v-model="tokenQuery"
                class="input"
                type="search"
                placeholder="Token name…"
              />
            </div>
          </div>
          <div v-if="tokenTotal === 0" class="muted mt-5">
            {{ tokenQuery.trim() ? "No tokens match these filters" : "No tokens" }}
          </div>
          <template v-else>
            <div class="table-wrap mt-5">
              <table class="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="name"
                      label="Name"
                      :sort="tokenSort"
                      :order="tokenOrder"
                      @sort="setTokenSort"
                    />
                    <SortableTh
                      column="createdAt"
                      label="Created"
                      :sort="tokenSort"
                      :order="tokenOrder"
                      default-order="desc"
                      @sort="setTokenSort"
                    />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="token in tokenItems" :key="token.id">
                    <td>{{ token.name }}</td>
                    <td class="mono muted">{{ new Date(token.createdAt).toLocaleString() }}</td>
                    <td>
                      <AppButton
                        variant="danger"
                        size="sm"
                        :icon="Trash2"
                        :loading="busy"
                        loading-label="Working…"
                        @click="revokeToken(token.id)"
                      >
                        Revoke
                      </AppButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <TablePager
              v-model:page="tokenPage"
              :page-count="tokenPages"
              :range-label="tokenRange"
              :total="tokenTotal"
            />
          </template>
        </div>
      </section>

      <NotificationChannelsPanel
        :initial-channels="channels"
        @error="onChannelError"
        @message="onChannelMessage"
      />

      <section class="panel">
        <div class="panel-header">Backups</div>
        <div class="panel-body">
          <p class="muted">
            Create and verify archives under the Gojo data directory. Restore remains CLI-only
            <span class="mono">gojo backup restore</span>.
          </p>
          <AppButton
            variant="primary"
            class="mt-4"
            :icon="HardDrive"
            :loading="busy"
            loading-label="Creating…"
            @click="doCreateBackup"
          >
            Create backup
          </AppButton>
          <div class="inline-form mt-5 task-filters">
            <div class="field flex-2">
              <label for="backup-search">Search</label>
              <input
                id="backup-search"
                v-model="backupQuery"
                class="input"
                type="search"
                placeholder="Backup name…"
              />
            </div>
          </div>
          <div v-if="backupTotal === 0" class="muted mt-5">
            {{ backupQuery.trim() ? "No backups match these filters" : "No backups" }}
          </div>
          <template v-else>
            <div class="table-wrap mt-5">
              <table class="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="name"
                      label="Name"
                      :sort="backupSort"
                      :order="backupOrder"
                      @sort="setBackupSort"
                    />
                    <th>Size</th>
                    <SortableTh
                      column="createdAt"
                      label="Created"
                      :sort="backupSort"
                      :order="backupOrder"
                      default-order="desc"
                      @sort="setBackupSort"
                    />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="backup in backupItems" :key="backup.path">
                    <td class="mono">{{ backup.name }}</td>
                    <td class="mono muted">{{ formatBytes(backup.size) }}</td>
                    <td class="mono muted">{{ new Date(backup.createdAt).toLocaleString() }}</td>
                    <td>
                      <AppButton
                        size="sm"
                        :icon="ShieldCheck"
                        :loading="busy"
                        loading-label="Verifying…"
                        @click="doVerify(backup.path)"
                      >
                        Verify
                      </AppButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <TablePager
              v-model:page="backupPage"
              :page-count="backupPages"
              :range-label="backupRange"
              :total="backupTotal"
            />
          </template>
        </div>
      </section>
    </template>
  </div>
</template>
