<script setup lang="ts">
import { ref } from "vue";

import {
  getHealth,
  getInstance,
  pauseInstance,
  resumeInstance,
  updateInstance,
} from "@/contexts/operations/contract";
import AppButton from "@/ui/AppButton.vue";
import { Network, Pause, Play, Power, Save } from "lucide-vue-next";
import type { CookieSecureMode } from "@gojo/contracts/types";
import type { HealthInfo, InstanceInfo } from "@/contexts/operations/types";

const emit = defineEmits<{
  error: [message: string];
  message: [message: string];
}>();

const instance = ref<InstanceInfo | null>(null);
const health = ref<HealthInfo | null>(null);
const busy = ref(false);
const networkRestartHint = ref(false);

const networkForm = ref({
  bindHost: "127.0.0.1",
  bindPort: 7430,
  publicBaseUrl: "",
  trustedProxies: "",
  allowedOrigins: "",
  ipAllowlist: "",
  cookieSecure: "auto" as CookieSecureMode,
});

function syncNetworkForm(info: InstanceInfo) {
  networkForm.value = {
    bindHost: info.bindHost,
    bindPort: info.bindPort,
    publicBaseUrl: info.publicBaseUrl ?? "",
    trustedProxies: (info.trustedProxies ?? []).join(", "),
    allowedOrigins: (info.allowedOrigins ?? []).join(", "),
    ipAllowlist: (info.ipAllowlist ?? []).join(", "),
    cookieSecure: info.cookieSecure ?? "auto",
  };
}

function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function applyCloudflarePreset() {
  const current = splitCsv(networkForm.value.trustedProxies);
  if (!current.some((entry) => entry.toLowerCase() === "cloudflare")) {
    current.push("cloudflare");
  }
  if (!current.includes("127.0.0.1")) {
    current.push("127.0.0.1");
  }
  networkForm.value.trustedProxies = current.join(", ");
  if (!networkForm.value.publicBaseUrl.trim() && typeof window !== "undefined") {
    const { protocol, host } = window.location;
    if (host !== "127.0.0.1" && host !== "localhost" && !host.startsWith("[")) {
      networkForm.value.publicBaseUrl = `${protocol}//${host}`;
    }
  }
}

async function load() {
  const [inst, h] = await Promise.all([getInstance(), getHealth()]);
  instance.value = inst;
  health.value = h;
  syncNetworkForm(inst);
  networkRestartHint.value = false;
}

async function togglePause() {
  if (!instance.value) return;
  busy.value = true;
  try {
    if (instance.value.paused) {
      await resumeInstance();
    } else {
      await pauseInstance();
    }
    instance.value = await getInstance();
    health.value = await getHealth();
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to update pause state");
  } finally {
    busy.value = false;
  }
}

async function toggleTelemetry() {
  if (!instance.value) return;
  busy.value = true;
  try {
    instance.value = await updateInstance({
      telemetryEnabled: !instance.value.telemetryEnabled,
    });
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to update telemetry");
  } finally {
    busy.value = false;
  }
}

async function saveNetwork() {
  busy.value = true;
  try {
    const publicRaw = networkForm.value.publicBaseUrl.trim();
    instance.value = await updateInstance({
      bindHost: networkForm.value.bindHost.trim(),
      bindPort: Number(networkForm.value.bindPort),
      publicBaseUrl: publicRaw.length > 0 ? publicRaw : null,
      trustedProxies: splitCsv(networkForm.value.trustedProxies),
      allowedOrigins: splitCsv(networkForm.value.allowedOrigins),
      ipAllowlist: splitCsv(networkForm.value.ipAllowlist),
      cookieSecure: networkForm.value.cookieSecure,
    });
    syncNetworkForm(instance.value);
    networkRestartHint.value = Boolean(instance.value.restartRequired);
    emit(
      "message",
      networkRestartHint.value
        ? "Network settings saved — restart the daemon for bind/proxy changes to take effect"
        : "Network settings saved",
    );
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to save network settings");
  } finally {
    busy.value = false;
  }
}

defineExpose({ instance, health, load });
void load();
</script>

<template>
  <template v-if="instance">
    <section class="panel">
      <div class="panel-header">Instance</div>
      <div class="panel-body">
        <p class="mono">{{ instance.bindHost }}:{{ instance.bindPort }}</p>
        <p v-if="instance.publicBaseUrl" class="mono muted mt-2">
          public {{ instance.publicBaseUrl }}
        </p>
        <p v-if="instance.apiBaseUrl" class="mono muted mt-2">
          agents {{ instance.apiBaseUrl }}
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
      <div class="panel-header">Network</div>
      <div class="panel-body">
        <p class="muted mb-5">
          Cloudflare (or any reverse proxy) terminates TLS. Gojo speaks HTTP on the bind address.
          Set <span class="mono">publicBaseUrl</span> to the URL browsers and agents use, and
          <span class="mono">trustedProxies</span> so
          <span class="mono">X-Forwarded-*</span> is honored.
        </p>
        <div class="inline-form network-form">
          <div class="field">
            <label for="net-bind-host">Bind host</label>
            <input id="net-bind-host" v-model="networkForm.bindHost" class="input" type="text" />
          </div>
          <div class="field">
            <label for="net-bind-port">Bind port</label>
            <input
              id="net-bind-port"
              v-model.number="networkForm.bindPort"
              class="input"
              type="number"
              min="1"
              max="65535"
            />
          </div>
          <div class="field field-wide">
            <label for="net-public-url">Public base URL</label>
            <input
              id="net-public-url"
              v-model="networkForm.publicBaseUrl"
              class="input"
              type="url"
              placeholder="https://gojo.example.com"
            />
          </div>
          <div class="field field-wide">
            <label for="net-proxies">Trusted proxies</label>
            <input
              id="net-proxies"
              v-model="networkForm.trustedProxies"
              class="input"
              type="text"
              placeholder="cloudflare, 127.0.0.1"
            />
          </div>
          <div class="field field-wide">
            <label for="net-origins">Allowed origins</label>
            <input
              id="net-origins"
              v-model="networkForm.allowedOrigins"
              class="input"
              type="text"
              placeholder="(defaults to publicBaseUrl origin)"
            />
          </div>
          <div class="field field-wide">
            <label for="net-allowlist">IP allowlist</label>
            <input
              id="net-allowlist"
              v-model="networkForm.ipAllowlist"
              class="input"
              type="text"
              placeholder="(empty = any)"
            />
          </div>
          <div class="field">
            <label for="net-cookie">Cookie Secure</label>
            <select id="net-cookie" v-model="networkForm.cookieSecure" class="input">
              <option value="auto">auto</option>
              <option value="always">always</option>
              <option value="never">never</option>
            </select>
          </div>
        </div>
        <div class="toolbar mt-5">
          <AppButton
            size="sm"
            variant="primary"
            :icon="Save"
            :loading="busy"
            loading-label="Saving…"
            @click="saveNetwork"
          >
            Save network
          </AppButton>
          <AppButton size="sm" :icon="Network" :disabled="busy" @click="applyCloudflarePreset">
            Cloudflare preset
          </AppButton>
        </div>
        <p v-if="networkRestartHint" class="alert alert-info mt-5">
          Restart required: <span class="mono">gojo service restart</span>
        </p>
        <p class="muted mt-4">
          Tunnel tip: if cloudflared connects on localhost, include
          <span class="mono">127.0.0.1</span> in trusted proxies. Classic orange-cloud proxy needs
          the <span class="mono">cloudflare</span> token (published CF CIDRs).
        </p>
      </div>
    </section>
  </template>
</template>
