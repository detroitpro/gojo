<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, FileDiff, Pause, RefreshCw, X } from "lucide-vue-next";

import { getWorkDiff, listApprovals, updateApproval } from "@/api";
import AppButton from "@/components/AppButton.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { approvalStatus } from "@/lib/status-icons";
import type { Approval, ApprovalState } from "@/types";

const actionableOnly = ref(true);
const actionError = ref("");
const busy = ref<{ id: string; action: string } | null>(null);
const openDiffId = ref<string | null>(null);
const diffText = ref("");

const stateFilter = computed<ApprovalState | undefined>(() =>
  actionableOnly.value ? "awaiting-human" : undefined,
);

const {
  page,
  pages,
  items: approvals,
  total,
  loading,
  error,
  rangeLabel,
  load,
} = useServerTable({
  defaultSort: "updatedAt",
  defaultOrder: "desc",
  watchSources: [actionableOnly],
  fetchPage: ({ limit, offset }) =>
    listApprovals({ limit, offset, state: stateFilter.value }),
});

useLiveRefresh({
  topics: ["work", "runs"],
  refresh: load,
  immediate: false,
});

function spec(approval: Approval) {
  return approvalStatus(approval.state);
}

function isBusy(approval: Approval, action: string) {
  return busy.value?.id === approval.id && busy.value.action === action;
}

async function act(approval: Approval, action: "approve" | "reject" | "hold") {
  busy.value = { id: approval.id, action };
  actionError.value = "";
  try {
    await updateApproval(approval.id, action);
    await load();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = null;
  }
}

async function toggleDiff(approval: Approval) {
  if (openDiffId.value === approval.id) {
    openDiffId.value = null;
    diffText.value = "";
    return;
  }
  if (!approval.workItemId) return;
  busy.value = { id: approval.id, action: "diff" };
  actionError.value = "";
  try {
    diffText.value = await getWorkDiff(approval.workItemId);
    openDiffId.value = approval.id;
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section class="panel approvals-page">
    <header class="section-header">
      <div>
        <h1>Approvals</h1>
        <p class="muted">Review settled checks and control platform-owned merges.</p>
      </div>
      <div class="header-actions">
        <AppButton
          variant="ghost"
          size="sm"
          :icon="Check"
          :selected="actionableOnly"
          @click="actionableOnly = !actionableOnly"
        >
          Needs action
        </AppButton>
        <AppButton
          size="sm"
          :icon="RefreshCw"
          :loading="loading"
          loading-label="Refreshing…"
          @click="load()"
        >
          Refresh
        </AppButton>
      </div>
    </header>

    <p v-if="error || actionError" class="error">{{ actionError || error }}</p>
    <p v-else-if="!loading && approvals.length === 0" class="empty-state">
      No approvals match this view.
    </p>

    <div class="approval-grid">
      <article v-for="approval in approvals" :key="approval.id" class="approval-card">
        <div class="approval-card__header">
          <div>
            <div class="eyebrow">
              {{ approval.projectName || approval.projectId }}
              <span v-if="approval.agentName">· {{ approval.agentName }}</span>
            </div>
            <h2>{{ approval.workTitle || approval.reason || approval.subjectId }}</h2>
          </div>
          <StatusBadge
            :label="spec(approval).label"
            :icon="spec(approval).icon"
            :tone="spec(approval).tone"
          />
        </div>

        <dl class="approval-evidence">
          <div><dt>Checks</dt><dd>{{ approval.checksState || "unknown" }}</dd></div>
          <div><dt>Review</dt><dd>{{ approval.reviewVerdict || "pending" }}</dd></div>
          <div><dt>Authority</dt><dd>{{ approval.autonomy }}</dd></div>
          <div><dt>Fix rounds</dt><dd>{{ approval.attempts }}</dd></div>
        </dl>

        <p v-if="approval.lastError" class="error">{{ approval.lastError }}</p>
        <pre v-if="openDiffId === approval.id" class="approval-diff">{{ diffText }}</pre>

        <div class="approval-card__actions">
          <AppButton
            v-if="approval.workItemId"
            size="sm"
            :icon="FileDiff"
            :loading="isBusy(approval, 'diff')"
            loading-label="Loading diff…"
            @click="toggleDiff(approval)"
          >
            {{ openDiffId === approval.id ? "Hide diff" : "View diff" }}
          </AppButton>
          <AppButton
            v-if="approval.workUrl"
            size="sm"
            :href="approval.workUrl"
            target="_blank"
            rel="noopener noreferrer"
            :icon="FileDiff"
          >
            Open source
          </AppButton>
          <AppButton
            v-if="approval.state === 'awaiting-human'"
            variant="primary"
            size="sm"
            :icon="Check"
            :loading="isBusy(approval, 'approve')"
            loading-label="Approving…"
            @click="act(approval, 'approve')"
          >
            Approve
          </AppButton>
          <AppButton
            v-if="approval.state !== 'applied' && approval.state !== 'rejected'"
            size="sm"
            :icon="Pause"
            :loading="isBusy(approval, 'hold')"
            loading-label="Holding…"
            @click="act(approval, 'hold')"
          >
            Hold
          </AppButton>
          <AppButton
            v-if="approval.state !== 'applied' && approval.state !== 'rejected'"
            variant="danger"
            size="sm"
            :icon="X"
            :loading="isBusy(approval, 'reject')"
            loading-label="Rejecting…"
            @click="act(approval, 'reject')"
          >
            Reject
          </AppButton>
        </div>
      </article>
    </div>

    <TablePager
      v-model:page="page"
      :page-count="pages"
      :range-label="rangeLabel"
      :total="total"
    />
  </section>
</template>
