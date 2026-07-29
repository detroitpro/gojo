<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { listAgents, testAgent } from "@/api";
import AppButton from "@/components/AppButton.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useClientPager } from "@/composables/useClientPager";
import { FlaskConical, RefreshCw } from "lucide-vue-next";
import type { AgentInfo, AgentTestResult } from "@/types";

const agents = ref<AgentInfo[]>([]);
const loading = ref(true);
const error = ref("");
const busyName = ref<string | null>(null);
const testResult = ref<{ name: string; result: AgentTestResult } | null>(null);
const query = ref("");
const installedFilter = ref<"all" | "yes" | "no">("all");

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return agents.value.filter((agent) => {
    if (installedFilter.value === "yes" && !agent.installed) {
      return false;
    }
    if (installedFilter.value === "no" && agent.installed) {
      return false;
    }
    if (!q) {
      return true;
    }
    return (
      agent.name.toLowerCase().includes(q) ||
      (agent.version?.toLowerCase().includes(q) ?? false)
    );
  });
});

const { page, pages, pageItems, total, sort, order, setSort, rangeLabel, reset } = useClientPager(
  filtered,
  25,
  { defaultSort: "name", defaultOrder: "asc" },
);

watch([query, installedFilter], () => {
  reset();
});

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
      <AppButton size="sm" :icon="RefreshCw" :loading="loading" loading-label="Detecting…" @click="load">
        Re-detect
      </AppButton>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field">
        <label for="agent-installed-filter">Installed</label>
        <select id="agent-installed-filter" v-model="installedFilter">
          <option value="all">All</option>
          <option value="yes">Installed</option>
          <option value="no">Missing</option>
        </select>
      </div>
      <div class="field flex-2">
        <label for="agent-search">Search</label>
        <input
          id="agent-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Adapter name, version…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} agent{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading" class="empty">Detecting…</div>
    <div v-else-if="agents.length === 0" class="empty">No adapters registered</div>
    <div v-else-if="total === 0" class="empty">No agents match these filters</div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <SortableTh column="name" label="Adapter" :sort="sort" :order="order" @sort="setSort" />
              <SortableTh
                column="installed"
                label="Installed"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
              <SortableTh
                column="version"
                label="Version"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Authenticated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in pageItems" :key="agent.name">
              <td class="mono">{{ agent.name }}</td>
              <td>
                <span class="status-dot" :class="agent.installed ? 'ok' : 'bad'"></span>
                {{ agent.installed ? "yes" : "no" }}
              </td>
              <td class="mono muted">{{ agent.version ?? "—" }}</td>
              <td>
                <template v-if="agent.authenticated === undefined">—</template>
                <template v-else>
                  <span class="status-dot" :class="agent.authenticated ? 'ok' : 'bad'"></span>
                  {{ agent.authenticated ? "yes" : "no" }}
                </template>
              </td>
              <td>
                <AppButton
                  size="sm"
                  :icon="FlaskConical"
                  :loading="busyName === agent.name"
                  loading-label="Testing…"
                  @click="runTest(agent.name)"
                >
                  Test
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <TablePager
        v-model:page="page"
        :page-count="pages"
        :range-label="rangeLabel"
        :total="total"
      />
    </template>

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
