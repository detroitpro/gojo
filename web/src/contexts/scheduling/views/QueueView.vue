<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink } from "vue-router";
import { storeToRefs } from "pinia";

import { useSchedulingStore } from "@/contexts/scheduling/contract";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import AppButton from "@/ui/AppButton.vue";
import PageHeader from "@/ui/PageHeader.vue";
import StatGrid from "@/ui/StatGrid.vue";
import StatTile from "@/ui/StatTile.vue";
import StateBadge from "@/ui/StateBadge.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { RefreshCw } from "lucide-vue-next";

const store = useSchedulingStore();
const {
  policy,
  running,
  waiting,
  counts,
  total,
  limit,
  offset,
  loading,
  error,
  sort,
  order,
} = storeToRefs(store);

const page = computed({
  get: () => Math.floor(offset.value / limit.value) + 1,
  set: (value: number) => {
    void store.load({ offset: (value - 1) * limit.value });
  },
});
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));
const rangeLabel = computed(() => {
  if (total.value === 0) return "0–0 of 0";
  const start = offset.value + 1;
  const end = Math.min(offset.value + waiting.value.length, total.value);
  return `${start}–${end} of ${total.value}`;
});

function setSort(column: string) {
  if (sort.value === column) {
    void store.load({ order: order.value === "asc" ? "desc" : "asc", offset: 0 });
    return;
  }
  void store.load({ sort: column, order: "asc", offset: 0 });
}

function fmtTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

bindStoreRefresh(store, () => store.load());

watch([page], () => {
  // page setter already loads
});
</script>

<template>
  <div>
    <PageHeader
      title="Queue"
      subtitle="Cron times are suggestions — the dispatcher admits runs under the global concurrency cap"
    >
      <template #actions>
        <AppButton
          size="sm"
          :icon="RefreshCw"
          :loading="loading"
          loading-label="Refreshing…"
          @click="store.load()"
        >
          Refresh
        </AppButton>
      </template>
    </PageHeader>

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
