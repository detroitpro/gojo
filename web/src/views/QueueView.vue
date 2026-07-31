<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";

import { getQueue } from "@/api";
import AppButton from "@/components/AppButton.vue";
import StatGrid from "@/components/StatGrid.vue";
import StatTile from "@/components/StatTile.vue";
import StateBadge from "@/components/StateBadge.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { RefreshCw } from "lucide-vue-next";
import type { QueueRunningItem, SchedulingPolicy } from "@/types";

const policy = ref<SchedulingPolicy | null>(null);
const running = ref<QueueRunningItem[]>([]);
const counts = ref({ running: 0, waiting: 0 });

const {
  page,
  pages,
  items: waiting,
  total,
  loading,
  error,
  sort,
  order,
  setSort,
  rangeLabel,
  load,
} = useServerTable({
  defaultSort: "position",
  defaultOrder: "asc",
  watchSources: [],
  fetchPage: async ({ limit, offset, sort: sortBy, order: sortOrder }) => {
    const snap = await getQueue({ limit, offset, sort: sortBy, order: sortOrder });
    policy.value = snap.policy;
    running.value = snap.running;
    counts.value = snap.counts;
    return {
      items: snap.waiting,
      total: snap.total,
      limit: snap.limit,
      offset: snap.offset,
    };
  },
});

function fmtTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

useLiveRefresh({
  topics: ["queue"],
  refresh: load,
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Queue</h1>
        <div class="subtitle">
          Cron times are suggestions — the dispatcher admits runs under the global concurrency cap
        </div>
      </div>
      <div class="toolbar">
        <AppButton
          size="sm"
          :icon="RefreshCw"
          :loading="loading"
          loading-label="Refreshing…"
          @click="load"
        >
          Refresh
        </AppButton>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <StatGrid v-if="policy">
      <StatTile
        metric-key="queue.running"
        :value="`${counts.running} / ${policy.maxConcurrentRuns}`"
      />
      <StatTile metric-key="queue.waiting" :value="counts.waiting" />
      <StatTile metric-key="queue.perProject" :value="policy.maxConcurrentRunsPerProject" />
      <StatTile
        metric-key="queue.stagger"
        :value="`${Math.round(policy.minStartIntervalMs / 1000)}s`"
      />
    </StatGrid>

    <section class="list-section">
      <div class="list-section__header">
        <h2 class="list-section__title">Running now</h2>
        <span class="list-section__meta">{{ running.length }}</span>
      </div>
      <div v-if="running.length === 0" class="muted">No runs occupying slots</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Project</th>
              <th>State</th>
              <th>Admitted</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in running" :key="item.runId">
              <td>
                <RouterLink :to="{ name: 'run-detail', params: { id: item.runId } }">
                  {{ item.agentName || "—" }}
                </RouterLink>
              </td>
              <td>{{ item.projectName || "—" }}</td>
              <td><StateBadge :state="item.state" /></td>
              <td class="mono muted text-sm">{{ fmtTime(item.admittedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="list-section">
      <div class="list-section__header">
        <h2 class="list-section__title">Waiting for a slot</h2>
        <span class="list-section__meta">{{ total }}</span>
      </div>
      <div v-if="loading && waiting.length === 0" class="muted">Loading…</div>
      <div v-else-if="total === 0" class="muted">Queue is empty</div>
      <template v-else>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <SortableTh
                  column="position"
                  label="#"
                  :sort="sort"
                  :order="order"
                  @sort="setSort"
                />
                <SortableTh
                  column="agentName"
                  label="Agent"
                  :sort="sort"
                  :order="order"
                  @sort="setSort"
                />
                <SortableTh
                  column="projectName"
                  label="Project"
                  :sort="sort"
                  :order="order"
                  @sort="setSort"
                />
                <SortableTh
                  column="priority"
                  label="Priority"
                  :sort="sort"
                  :order="order"
                  @sort="setSort"
                />
                <SortableTh
                  column="notBeforeAt"
                  label="Suggested start"
                  :sort="sort"
                  :order="order"
                  @sort="setSort"
                />
                <SortableTh
                  column="expiresAt"
                  label="Expires"
                  :sort="sort"
                  :order="order"
                  @sort="setSort"
                />
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in waiting" :key="item.runId">
                <td class="mono">{{ item.position }}</td>
                <td>
                  <RouterLink :to="{ name: 'run-detail', params: { id: item.runId } }">
                    {{ item.agentName || "—" }}
                  </RouterLink>
                  <div class="mono muted text-sm">{{ item.trigger }}</div>
                </td>
                <td>{{ item.projectName || "—" }}</td>
                <td class="mono">{{ item.priority }}</td>
                <td class="mono muted text-sm">{{ fmtTime(item.notBeforeAt) }}</td>
                <td class="mono muted text-sm">{{ fmtTime(item.expiresAt) }}</td>
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
    </section>
  </div>
</template>
