<script setup lang="ts">
import { ref } from "vue";

import { createBackup, listBackups, verifyBackup } from "@/contexts/operations/contract";
import AppButton from "@/ui/AppButton.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { useServerTable } from "@/platform/useServerTable";
import { HardDrive, ShieldCheck } from "lucide-vue-next";

const emit = defineEmits<{
  error: [message: string];
  message: [message: string];
}>();

const busy = ref(false);
const backupQuery = ref("");

const {
  page: backupPage,
  pages: backupPages,
  items: backupItems,
  total: backupTotal,
  sort: backupSort,
  order: backupOrder,
  setSort: setBackupSort,
  rangeLabel: backupRange,
  load: loadBackups,
} = useServerTable({
  defaultSort: "createdAt",
  defaultOrder: "desc",
  watchSources: [backupQuery],
  fetchPage: ({ limit, offset, sort, order }) =>
    listBackups({
      limit,
      offset,
      sort,
      order,
      q: backupQuery.value || undefined,
    }),
});

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function load() {
  await loadBackups();
}

async function doCreateBackup() {
  busy.value = true;
  try {
    const result = await createBackup();
    emit("message", `Backup created: ${result.path}`);
    await loadBackups();
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Backup failed");
  } finally {
    busy.value = false;
  }
}

async function doVerify(path: string) {
  busy.value = true;
  try {
    const result = await verifyBackup(path);
    emit("message", result.valid ? `Valid: ${result.path}` : `Invalid: ${result.path}`);
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Verify failed");
  } finally {
    busy.value = false;
  }
}

defineExpose({ load });
void load();
</script>

<template>
  <section class="panel">
    <div class="panel-header">Backups</div>
    <div class="panel-body">
      <p class="muted">
        Create and verify archives under the Gojo data directory. Restore remains CLI-only
        <span class="mono">gojo backup restore</span>.
      </p>
      <AppButton
        variant="primary"
        class="mt-4"
        :icon="HardDrive"
        :loading="busy"
        loading-label="Creating…"
        @click="doCreateBackup"
      >
        Create backup
      </AppButton>
      <div class="inline-form mt-5 task-filters">
        <div class="field flex-2">
          <label for="backup-search">Search</label>
          <input
            id="backup-search"
            v-model="backupQuery"
            class="input"
            type="search"
            placeholder="Backup name…"
          />
        </div>
      </div>
      <div v-if="backupTotal === 0" class="muted mt-5">
        {{ backupQuery.trim() ? "No backups match these filters" : "No backups" }}
      </div>
      <template v-else>
        <div class="table-wrap mt-5">
          <table class="data">
            <thead>
              <tr>
                <SortableTh
                  column="name"
                  label="Name"
                  :sort="backupSort"
                  :order="backupOrder"
                  @sort="setBackupSort"
                />
                <th>Size</th>
                <SortableTh
                  column="createdAt"
                  label="Created"
                  :sort="backupSort"
                  :order="backupOrder"
                  default-order="desc"
                  @sort="setBackupSort"
                />
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="backup in backupItems" :key="backup.path">
                <td class="mono">{{ backup.name }}</td>
                <td class="mono muted">{{ formatBytes(backup.size) }}</td>
                <td class="mono muted">{{ new Date(backup.createdAt).toLocaleString() }}</td>
                <td>
                  <AppButton
                    size="sm"
                    :icon="ShieldCheck"
                    :loading="busy"
                    loading-label="Verifying…"
                    @click="doVerify(backup.path)"
                  >
                    Verify
                  </AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <TablePager
          v-model:page="backupPage"
          :page-count="backupPages"
          :range-label="backupRange"
          :total="backupTotal"
        />
      </template>
    </div>
  </section>
</template>
