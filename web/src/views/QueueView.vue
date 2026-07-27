<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import { getQueue } from "@/api";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";
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

onMounted(() => {
  void load();
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
      <button class="btn btn-sm" type="button" :disabled="loading" @click="load">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="policy" class="stats-row">
      <div class="stat">
        <div class="label">Running</div>
        <div class="value">{{ counts.running }} / {{ policy.maxConcurrentRuns }}</div>
      </div>
      <div class="stat">
        <div class="label">Waiting</div>
        <div class="value">{{ counts.waiting }}</div>
      </div>
      <div class="stat">
        <div class="label">Per project</div>
        <div class="value compact">{{ policy.maxConcurrentRunsPerProject }}</div>
      </div>
      <div class="stat">
        <div class="label">Stagger</div>
        <div class="value compact">{{ Math.round(policy.minStartIntervalMs / 1000) }}s</div>
      </div>
    </div>

    <section class="panel mb-7">
      <div class="panel-header">Running now</div>
      <div class="panel-body">
        <div v-if="running.length === 0" class="muted">No runs occupying slots</div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Task</th>
                <th>Project</th>
                <th>State</th>
                <th>Admitted</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in running" :key="item.runId">
                <td>
                  <RouterLink :to="{ name: 'run-detail', params: { id: item.runId } }">
                    {{ item.taskName || "—" }}
                  </RouterLink>
                </td>
                <td>{{ item.projectName || "—" }}</td>
                <td><span class="badge badge-queued">{{ item.state }}</span></td>
                <td class="mono muted text-sm">{{ fmtTime(item.admittedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">Waiting for a slot</div>
      <div class="panel-body">
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
                    column="taskName"
                    label="Task"
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
                      {{ item.taskName || "—" }}
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
      </div>
    </section>
  </div>
</template>
