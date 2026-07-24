<script setup lang="ts">
import { onMounted, ref } from "vue";

import { listAgents, testAgent } from "@/api";
import type { AgentInfo, AgentTestResult } from "@/types";

const agents = ref<AgentInfo[]>([]);
const loading = ref(true);
const error = ref("");
const busyName = ref<string | null>(null);
const testResult = ref<{ name: string; result: AgentTestResult } | null>(null);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    agents.value = await listAgents();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to detect agents";
  } finally {
    loading.value = false;
  }
}

async function runTest(name: string) {
  busyName.value = name;
  error.value = "";
  testResult.value = null;
  try {
    const result = await testAgent(name);
    testResult.value = { name, result };
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Agent test failed";
  } finally {
    busyName.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Agents</h1>
        <div class="subtitle">Adapter detection status</div>
      </div>
      <button class="btn btn-sm" type="button" @click="load">Re-detect</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Detecting…</div>
    <div v-else-if="agents.length === 0" class="empty">No adapters registered</div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Adapter</th>
            <th>Installed</th>
            <th>Version</th>
            <th>Authenticated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="agent in agents" :key="agent.name">
            <td class="mono">{{ agent.name }}</td>
            <td>
              <span
                class="status-dot"
                :class="agent.installed ? 'ok' : 'bad'"
              ></span>
              {{ agent.installed ? "yes" : "no" }}
            </td>
            <td class="mono muted">{{ agent.version ?? "—" }}</td>
            <td>
              <template v-if="agent.authenticated === undefined">—</template>
              <template v-else>
                <span
                  class="status-dot"
                  :class="agent.authenticated ? 'ok' : 'bad'"
                ></span>
                {{ agent.authenticated ? "yes" : "no" }}
              </template>
            </td>
            <td>
              <button
                class="btn btn-sm"
                type="button"
                :disabled="busyName === agent.name"
                @click="runTest(agent.name)"
              >
                Test
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="testResult" class="panel mt-7">
      <div class="panel-header">Test result — {{ testResult.name }}</div>
      <div class="panel-body">
        <div class="mono">
          exitCode={{ testResult.result.exitCode }} timedOut={{ testResult.result.timedOut }}
          canceled={{ testResult.result.canceled }}
        </div>
        <pre v-if="testResult.result.stdout" class="pre-block mt-4">{{
          testResult.result.stdout
        }}</pre>
        <pre v-if="testResult.result.stderr" class="pre-block mt-4">{{
          testResult.result.stderr
        }}</pre>
      </div>
    </section>
  </div>
</template>
