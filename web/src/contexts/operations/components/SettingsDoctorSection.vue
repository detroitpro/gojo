<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { getInstanceDoctor } from "@/contexts/operations/contract";
import AppButton from "@/ui/AppButton.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { useClientPager } from "@/platform/useClientPager";
import { RefreshCw } from "lucide-vue-next";
import type { InstanceDoctorResult } from "@/contexts/operations/types";

const emit = defineEmits<{
  error: [message: string];
}>();

const doctor = ref<InstanceDoctorResult | null>(null);
const busy = ref(false);
const doctorQuery = ref("");

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
  doctor.value = await getInstanceDoctor();
}

async function refreshDoctor() {
  busy.value = true;
  try {
    await load();
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Doctor failed");
  } finally {
    busy.value = false;
  }
}

defineExpose({ load });
void load();
</script>

<template>
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
</template>
