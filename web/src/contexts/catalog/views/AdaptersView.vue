<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { listAdapters, testAdapter } from "@/contexts/catalog/contract";
import AppButton from "@/ui/AppButton.vue";
import PageHeader from "@/ui/PageHeader.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { useClientPager } from "@/platform/useClientPager";
import { FlaskConical, RefreshCw } from "lucide-vue-next";
import type { AdapterInfo, AdapterTestResult } from "@/contexts/catalog/types";

const adapters = ref<AdapterInfo[]>([]);
const loading = ref(true);
const error = ref("");
const busyName = ref<string | null>(null);
const testResult = ref<{ name: string; result: AdapterTestResult } | null>(null);
const query = ref("");
const installedFilter = ref<"all" | "yes" | "no">("all");

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return adapters.value.filter((adapter) => {
    if (installedFilter.value === "yes" && !adapter.installed) {
      return false;
    }
    if (installedFilter.value === "no" && adapter.installed) {
      return false;
    }
    if (!q) {
      return true;
    }
    return (
      adapter.name.toLowerCase().includes(q) ||
      (adapter.version?.toLowerCase().includes(q) ?? false)
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
    adapters.value = await listAdapters();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to detect adapters";
  } finally {
    loading.value = false;
  }
}

async function runTest(name: string) {
  busyName.value = name;
  error.value = "";
  testResult.value = null;
  try {
    const result = await testAdapter(name);
    testResult.value = { name, result };
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Adapter test failed";
  } finally {
    busyName.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Adapters" subtitle="Adapter detection status">
      <template #actions>
        <AppButton size="sm" :icon="RefreshCw" :loading="loading" loading-label="Detecting…" @click="load">
          Re-detect
        </AppButton>
      </template>
    </PageHeader>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field">
        <label for="adapter-installed-filter">Installed</label>
        <select id="adapter-installed-filter" v-model="installedFilter">
          <option value="all">All</option>
          <option value="yes">Installed</option>
          <option value="no">Missing</option>
        </select>
      </div>
      <div class="field flex-2">
        <label for="adapter-search">Search</label>
        <input
          id="adapter-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Adapter name, version…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} adapter{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading" class="empty">Detecting…</div>
    <div v-else-if="adapters.length === 0" class="empty">No adapters registered</div>
    <div v-else-if="total === 0" class="empty">No adapters match these filters</div>
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
            <tr v-for="adapter in pageItems" :key="adapter.name">
              <td class="mono">{{ adapter.name }}</td>
              <td>
                <span class="status-dot" :class="adapter.installed ? 'ok' : 'bad'"></span>
                {{ adapter.installed ? "yes" : "no" }}
              </td>
              <td class="mono muted">{{ adapter.version ?? "—" }}</td>
              <td>
                <template v-if="adapter.authenticated === undefined">—</template>
                <template v-else>
                  <span class="status-dot" :class="adapter.authenticated ? 'ok' : 'bad'"></span>
                  {{ adapter.authenticated ? "yes" : "no" }}
                </template>
              </td>
              <td>
                <AppButton
                  size="sm"
                  :icon="FlaskConical"
                  :loading="busyName === adapter.name"
                  loading-label="Testing…"
                  @click="runTest(adapter.name)"
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
