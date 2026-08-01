<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  createProject,
  deleteProject,
  getProjectDoctor,
  listProjects,
  syncProject,
} from "@/api";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu.vue";
import AppButton from "@/components/AppButton.vue";
import PageHeader from "@/components/PageHeader.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DirectoryPicker from "@/components/DirectoryPicker.vue";
import ModalDialog from "@/components/ModalDialog.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { type SortOrder } from "@/lib/pagination";
import HealthBadge from "@/components/status/HealthBadge.vue";
import {
  computeProjectHealth,
  type ProjectHealthSummary,
} from "@/lib/project-manifest";
import { FolderOpen, Plus } from "lucide-vue-next";
import type { Project } from "@/types";

const PROJECT_SORT_ALLOWED = ["name", "createdAt", "updatedAt", "defaultBranch"] as const;

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function initialSort(): string {
  const value = queryParam("sort");
  return (PROJECT_SORT_ALLOWED as readonly string[]).includes(value) ? value : "createdAt";
}

function initialOrder(): SortOrder {
  const value = queryParam("order");
  return value === "asc" || value === "desc" ? value : "asc";
}

const query = ref("");
const hasOpenPrs = ref(queryParam("hasOpenPrs") === "1" || queryParam("hasOpenPrs") === "true");
const busyId = ref<string | null>(null);
const addOpen = ref(false);
const creating = ref(false);
const pickerOpen = ref(false);
const name = ref("");
const repoPath = ref("");
const formError = ref("");
const notice = ref("");
const removeTarget = ref<Project | null>(null);
const healthById = ref<Record<string, ProjectHealthSummary>>({});
const healthLoading = ref(false);

const {
  page,
  pages,
  items: projects,
  total,
  loading,
  error,
  sort,
  order,
  setSort,
  rangeLabel,
  load,
} = useServerTable({
  defaultSort: initialSort(),
  defaultOrder: initialOrder(),
  watchSources: [query, hasOpenPrs],
  fetchPage: ({ limit, offset, sort: sortBy, order: sortOrder }) =>
    listProjects({
      limit,
      offset,
      sort: sortBy,
      order: sortOrder,
      q: query.value || undefined,
      ...(hasOpenPrs.value ? { hasOpenPrs: true } : {}),
    }),
});

watch([sort, order, hasOpenPrs], () => {
  const nextQuery = { ...route.query } as Record<string, string>;
  if (sort.value !== "createdAt" || order.value !== "asc") {
    nextQuery.sort = sort.value;
    nextQuery.order = order.value;
  } else {
    delete nextQuery.sort;
    delete nextQuery.order;
  }
  if (hasOpenPrs.value) {
    nextQuery.hasOpenPrs = "1";
  } else {
    delete nextQuery.hasOpenPrs;
  }
  const same =
    (nextQuery.sort ?? "") === queryParam("sort") &&
    (nextQuery.order ?? "") === queryParam("order") &&
    (nextQuery.hasOpenPrs ?? "") === queryParam("hasOpenPrs");
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

watch(
  () => route.query.hasOpenPrs,
  (value) => {
    const next = value === "1" || value === "true";
    if (hasOpenPrs.value !== next) {
      hasOpenPrs.value = next;
    }
  },
);

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || "project";
}

function onPicked(path: string) {
  repoPath.value = path;
  if (!name.value.trim()) {
    name.value = basename(path);
  }
  pickerOpen.value = false;
}

function configSummary(project: Project): string {
  if (!project.hasManifest && project.agentCount === 0) {
    return "Not synced";
  }
  return `${project.enabledAgentCount}/${project.agentCount} agents · ${project.enabledScheduleCount}/${project.scheduleCount} schedules`;
}

function healthFor(project: Project): ProjectHealthSummary {
  return (
    healthById.value[project.id] ?? {
      score: null,
      level: project.hasManifest ? "warn" : "missing",
      label: project.hasManifest ? "…" : "No manifest",
    }
  );
}

function rowActions(project: Project): ActionMenuItem[] {
  return [
    {
      id: "open",
      label: "Open",
      to: { name: "project-detail", params: { id: project.id } },
    },
    {
      id: "sync",
      label: "Sync",
      disabled: busyId.value === project.id,
    },
    {
      id: "remove",
      label: "Remove",
      danger: true,
      disabled: busyId.value === project.id,
    },
  ];
}

async function refreshHealth(list: Project[]) {
  if (list.length === 0) {
    healthById.value = {};
    return;
  }
  healthLoading.value = true;
  const next: Record<string, ProjectHealthSummary> = { ...healthById.value };
  await Promise.all(
    list.map(async (project) => {
      try {
        const doctor = await getProjectDoctor(project.id);
        next[project.id] = computeProjectHealth(project, doctor);
      } catch {
        next[project.id] = {
          score: null,
          level: "warn",
          label: "Unavailable",
        };
      }
    }),
  );
  healthById.value = next;
  healthLoading.value = false;
}

function openAdd() {
  formError.value = "";
  addOpen.value = true;
}

function closeAdd() {
  if (creating.value || pickerOpen.value) {
    return;
  }
  addOpen.value = false;
  formError.value = "";
}

async function addProject() {
  if (!name.value.trim() || !repoPath.value.trim()) {
    formError.value = "Name and repository path are required";
    return;
  }
  creating.value = true;
  formError.value = "";
  notice.value = "";
  try {
    await createProject({ name: name.value.trim(), repoPath: repoPath.value.trim() });
    name.value = "";
    repoPath.value = "";
    addOpen.value = false;
    await load();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to create project";
  } finally {
    creating.value = false;
  }
}

async function sync(project: Project) {
  busyId.value = project.id;
  error.value = "";
  notice.value = "";
  try {
    const result = await syncProject(project.id);
    const leaf = result.sync.manifestPath
      ? result.sync.manifestPath.split(/[/\\]/).slice(-1)[0]
      : "no manifest";
    notice.value = `${project.name}: synced from ${leaf} — ${result.sync.profiles} profiles, ${result.sync.agents} agents, ${result.sync.schedules} schedules`;
    await load();
    const doctor = await getProjectDoctor(project.id);
    const refreshed = projects.value.find((row) => row.id === project.id) ?? result.project;
    healthById.value = {
      ...healthById.value,
      [project.id]: computeProjectHealth(refreshed, doctor),
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    busyId.value = null;
  }
}

function onAction(project: Project, actionId: string) {
  if (actionId === "sync") {
    void sync(project);
  } else if (actionId === "remove") {
    removeTarget.value = project;
  }
}

async function confirmRemove() {
  const project = removeTarget.value;
  if (!project) {
    return;
  }
  busyId.value = project.id;
  error.value = "";
  notice.value = "";
  try {
    await deleteProject(project.id);
    removeTarget.value = null;
    const { [project.id]: _removed, ...rest } = healthById.value;
    healthById.value = rest;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Remove failed";
  } finally {
    busyId.value = null;
  }
}

watch(
  projects,
  (list) => {
    void refreshHealth(list);
  },
  { deep: true },
);

useLiveRefresh({
  topics: ["projects", "impact", "work", "sources"],
  refresh: load,
});
</script>

<template>
  <div>
    <PageHeader
      title="Projects"
      subtitle="Registered repositories — sync manifests, check health, open details"
    >
      <template #actions>
        <AppButton variant="primary" size="sm" :icon="Plus" @click="openAdd">Add project</AppButton>
      </template>
    </PageHeader>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" class="alert alert-success">{{ notice }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field flex-2">
        <label for="project-search">Search</label>
        <input
          id="project-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Name, path, id…"
        />
      </div>
      <div class="field">
        <label for="project-open-prs">Open PRs</label>
        <label class="checkbox-row" for="project-open-prs">
          <input id="project-open-prs" v-model="hasOpenPrs" type="checkbox" />
          Has open PRs
        </label>
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} project{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading && projects.length === 0" class="empty">Loading projects…</div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || hasOpenPrs
          ? "No projects match these filters"
          : "No projects yet — use Add project to register a repository"
      }}
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <SortableTh column="name" label="Name" :sort="sort" :order="order" @sort="setSort" />
              <th>Repo path</th>
              <SortableTh
                column="defaultBranch"
                label="Branch"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Config</th>
              <th>Open PRs</th>
              <th>
                Health
                <span v-if="healthLoading" class="muted text-sm"> …</span>
              </th>
              <SortableTh
                column="updatedAt"
                label="Updated"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in projects" :key="project.id">
              <td>
                <RouterLink
                  :to="{ name: 'project-detail', params: { id: project.id } }"
                  class="entity-name"
                >
                  {{ project.name }}
                </RouterLink>
                <div class="mono muted text-sm">{{ project.id.slice(0, 10) }}…</div>
              </td>
              <td class="mono muted">{{ project.repoPath }}</td>
              <td class="mono">{{ project.defaultBranch }}</td>
              <td class="muted">{{ configSummary(project) }}</td>
              <td>
                <RouterLink
                  v-if="project.openPrCount > 0"
                  :to="{
                    name: 'project-detail',
                    params: { id: project.id },
                    hash: '#open-prs',
                  }"
                  class="entity-name"
                >
                  {{ project.openPrCount }}
                </RouterLink>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <HealthBadge
                  :level="healthFor(project).level"
                  :label="healthFor(project).label"
                />
              </td>
              <td class="mono muted">{{ new Date(project.updatedAt).toLocaleString() }}</td>
              <td class="actions-cell">
                <ActionMenu
                  :items="rowActions(project)"
                  :disabled="busyId === project.id"
                  :label="`Actions for ${project.name}`"
                  @select="(id) => onAction(project, id)"
                />
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

    <ModalDialog
      :open="addOpen"
      title="Add project"
      wide
      :close-on-escape="!pickerOpen && !creating"
      :close-on-backdrop="!pickerOpen && !creating"
      @close="closeAdd"
    >
      <form id="add-project-form" @submit.prevent="addProject">
        <div v-if="formError" class="alert alert-error">{{ formError }}</div>
        <div class="field">
          <label for="project-name">Name</label>
          <input
            id="project-name"
            v-model="name"
            class="input"
            required
            placeholder="my-app"
            :disabled="creating"
          />
        </div>
        <div class="field">
          <label for="project-path">Repository path</label>
          <div class="path-input-row">
            <input
              id="project-path"
              v-model="repoPath"
              class="input"
              required
              readonly
              placeholder="Browse to a git checkout…"
              :disabled="creating"
              @click="pickerOpen = true"
            />
            <AppButton :icon="FolderOpen" :disabled="creating" @click="pickerOpen = true">
              Browse
            </AppButton>
          </div>
        </div>
      </form>
      <template #footer>
        <AppButton :disabled="creating" @click="closeAdd">Cancel</AppButton>
        <AppButton
          variant="primary"
          :icon="Plus"
          type="submit"
          form="add-project-form"
          :loading="creating"
          loading-label="Adding…"
        >
          Add project
        </AppButton>
      </template>
    </ModalDialog>

    <DirectoryPicker
      :open="pickerOpen"
      :initial-path="repoPath || undefined"
      @close="pickerOpen = false"
      @select="onPicked"
    />

    <ConfirmDialog
      :open="Boolean(removeTarget)"
      title="Remove project?"
      confirm-label="Remove project"
      danger
      :busy="Boolean(removeTarget && busyId === removeTarget.id)"
      @close="removeTarget = null"
      @confirm="confirmRemove"
    >
      <p>
        Unregister <strong>{{ removeTarget?.name }}</strong> from gojo. Scheduled work for this
        project stops, and gojo’s local history for it is removed.
      </p>
      <p class="muted mt-3">
        This does <strong>not</strong> delete the git repository at
        <span class="mono">{{ removeTarget?.repoPath }}</span>.
      </p>
    </ConfirmDialog>
  </div>
</template>
