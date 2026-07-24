<script setup lang="ts">
import { onMounted, ref } from "vue";

import {
  createApiToken,
  createBackup,
  getHealth,
  getInstance,
  getInstanceDoctor,
  listApiTokens,
  listBackups,
  listNotificationChannels,
  pauseInstance,
  putNotificationChannels,
  resumeInstance,
  revokeApiToken,
  updateInstance,
  verifyBackup,
} from "@/api";
import type {
  ApiTokenInfo,
  BackupInfo,
  HealthInfo,
  InstanceDoctorResult,
  InstanceInfo,
} from "@/types";

const instance = ref<InstanceInfo | null>(null);
const health = ref<HealthInfo | null>(null);
const doctor = ref<InstanceDoctorResult | null>(null);
const tokens = ref<ApiTokenInfo[]>([]);
const backups = ref<BackupInfo[]>([]);
const channelsJson = ref("{}");
const tokenName = ref("");
const createdToken = ref<string | null>(null);
const loading = ref(true);
const error = ref("");
const busy = ref(false);
const message = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    const [inst, h, toks, channels, backs, doc] = await Promise.all([
      getInstance(),
      getHealth(),
      listApiTokens(),
      listNotificationChannels(),
      listBackups(),
      getInstanceDoctor(),
    ]);
    instance.value = inst;
    health.value = h;
    tokens.value = toks;
    channelsJson.value = JSON.stringify(channels, null, 2);
    backups.value = backs;
    doctor.value = doc;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load settings";
  } finally {
    loading.value = false;
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

async function saveChannels() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const parsed = JSON.parse(channelsJson.value) as Record<string, unknown>;
    const saved = await putNotificationChannels(parsed);
    channelsJson.value = JSON.stringify(saved, null, 2);
    message.value = "Notification channels saved";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to save channels";
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
    tokens.value = await listApiTokens();
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
    tokens.value = await listApiTokens();
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
    backups.value = await listBackups();
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

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Settings</h1>
        <div class="subtitle">Instance configuration</div>
      </div>
      <button class="btn btn-sm" type="button" @click="load">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="message" class="alert alert-info">{{ message }}</div>
    <div v-if="loading" class="empty">Loading…</div>

    <template v-else-if="instance">
      <div class="stats-row">
        <div class="stat">
          <div class="label">Version</div>
          <div class="value" style="font-size: 16px">{{ health?.version ?? "—" }}</div>
        </div>
        <div class="stat">
          <div class="label">Scheduler</div>
          <div class="value" :class="instance.paused ? 'bad' : 'ok'" style="font-size: 16px">
            {{ instance.paused ? "Paused" : "Active" }}
          </div>
        </div>
        <div class="stat">
          <div class="label">Telemetry</div>
          <div class="value" style="font-size: 16px">
            {{ instance.telemetryEnabled ? "On" : "Off" }}
          </div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">Instance</div>
        <div class="panel-body">
          <p class="mono">{{ instance.bindHost }}:{{ instance.bindPort }}</p>
          <p class="muted" style="margin-top: 10px">
            Bind address is configured in instance.yaml. Remote access should run behind HTTPS, a
            reverse proxy, or VPN.
          </p>
          <div class="toolbar" style="margin-top: 12px">
            <button class="btn btn-sm" type="button" :disabled="busy" @click="togglePause">
              {{ instance.paused ? "Resume scheduler" : "Pause scheduler" }}
            </button>
            <button class="btn btn-sm" type="button" :disabled="busy" @click="toggleTelemetry">
              {{ instance.telemetryEnabled ? "Disable telemetry" : "Enable telemetry" }}
            </button>
          </div>
          <div class="mono muted" style="margin-top: 12px">
            health status={{ health?.status ?? "unknown" }} paused={{ String(health?.paused) }}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          Diagnostics
          <button class="btn btn-sm" type="button" :disabled="busy" @click="refreshDoctor">
            Re-run
          </button>
        </div>
        <div class="panel-body">
          <div v-if="!doctor" class="muted">No diagnostics yet</div>
          <template v-else>
            <div class="mono">
              git=<span :class="doctor.git ? 'ok' : 'bad'">{{ doctor.git }}</span>
              disk=<span :class="doctor.disk ? 'ok' : 'bad'">{{ doctor.disk }}</span>
              database=<span :class="doctor.database ? 'ok' : 'bad'">{{ doctor.database }}</span>
            </div>
            <div class="mono muted" style="margin-top: 8px">home={{ doctor.home }}</div>
            <div class="table-wrap" style="margin-top: 12px">
              <table class="data">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Installed</th>
                    <th>Version</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="agent in doctor.agents" :key="agent.name">
                    <td class="mono">{{ agent.name }}</td>
                    <td>{{ agent.installed ? "yes" : "no" }}</td>
                    <td class="mono muted">{{ agent.version ?? "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
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
            <button class="btn btn-primary" type="submit" :disabled="busy || !tokenName.trim()">
              Create token
            </button>
          </form>
          <div v-if="createdToken" class="alert alert-info" style="margin-top: 12px">
            Copy this token now; it will not be shown again.
            <pre class="pre-block" style="margin-top: 8px">{{ createdToken }}</pre>
          </div>
          <div v-if="tokens.length === 0" class="muted" style="margin-top: 12px">No tokens</div>
          <div v-else class="table-wrap" style="margin-top: 12px">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="token in tokens" :key="token.id">
                  <td>{{ token.name }}</td>
                  <td class="mono muted">{{ new Date(token.createdAt).toLocaleString() }}</td>
                  <td>
                    <button
                      class="btn btn-sm btn-danger"
                      type="button"
                      :disabled="busy"
                      @click="revokeToken(token.id)"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Notification channels</div>
        <div class="panel-body">
          <p class="muted">JSON map of channel name → connector config.</p>
          <textarea
            v-model="channelsJson"
            class="mono"
            rows="8"
            style="width: 100%; margin-top: 8px"
          ></textarea>
          <button
            class="btn btn-primary"
            type="button"
            style="margin-top: 10px"
            :disabled="busy"
            @click="saveChannels"
          >
            Save channels
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Backups</div>
        <div class="panel-body">
          <p class="muted">
            Create and verify archives under the Gojo data directory. Restore remains CLI-only
            (<span class="mono">gojo backup restore</span>.
          </p>
          <button
            class="btn btn-primary"
            type="button"
            style="margin-top: 10px"
            :disabled="busy"
            @click="doCreateBackup"
          >
            Create backup
          </button>
          <div v-if="backups.length === 0" class="muted" style="margin-top: 12px">No backups</div>
          <div v-else class="table-wrap" style="margin-top: 12px">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="backup in backups" :key="backup.path">
                  <td class="mono">{{ backup.name }}</td>
                  <td class="mono muted">{{ formatBytes(backup.size) }}</td>
                  <td class="mono muted">{{ new Date(backup.createdAt).toLocaleString() }}</td>
                  <td>
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busy"
                      @click="doVerify(backup.path)"
                    >
                      Verify
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
