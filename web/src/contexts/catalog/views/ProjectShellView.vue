<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import {
  Activity,
  HeartPulse,
  History,
  LayoutDashboard,
  Power,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-vue-next";

import {
  deleteProject,
  disableProject,
  enableProject,
  getProject,
  listAgents,
  syncProject,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { projectShellKey } from "@/contexts/catalog/project-shell";
import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import { getProjectDoctor } from "@/contexts/operations/contract";
import type { ProjectDoctorResult } from "@/contexts/operations/types";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import { useSoftLoading } from "@/platform/useSoftLoading";
import AppButton from "@/ui/AppButton.vue";
import ConfirmDialog from "@/ui/ConfirmDialog.vue";
import PageHeader from "@/ui/PageHeader.vue";
import ProjectSubnav, { type ProjectSubnavItem } from "@/ui/ProjectSubnav.vue";

const route = useRoute();
const router = useRouter();

const project = ref<Project | null>(null);
const doctor = ref<ProjectDoctorResult | null>(null);
const lastSync = ref<ProjectSyncResult | null>(null);
const projectAgents = ref<Agent[]>([]);
const openPrTotal = ref(0);
const dataVersion = ref(0);
const { loading, begin: beginLoad, end: endLoad, reset: resetLoad } = useSoftLoading();
const busy = ref(false);
const error = ref("");
const notice = ref("");
const removeOpen = ref(false);

const projectId = computed(() => route.params.id as string);

const subnavItems = computed<ProjectSubnavItem[]>(() => {
  const id = projectId.value;
  return [
    {
      name: "project-overview",
      label: "Overview",
      icon: LayoutDashboard,
      to: { name: "project-overview", params: { id } },
    },
    {
      name: "project-history",
      label: "History",
      icon: History,
      to: { name: "project-history", params: { id } },
    },
    {
      name: "project-impact",
      label: "Impact",
      icon: Activity,
      to: { name: "project-impact", params: { id } },
    },
    {
      name: "project-health",
      label: "Health",
      icon: HeartPulse,
      to: { name: "project-health", params: { id } },
    },
    {
      name: "project-configuration",
      label: "Configuration",
      icon: Settings2,
      to: { name: "project-configuration", params: { id } },
    },
  ];
});

function setOpenPrTotal(value: number) {
  openPrTotal.value = value;
}

function setError(message: string) {
  error.value = message;
}

function setNotice(message: string) {
  notice.value = message;
}

provide(projectShellKey, {
  projectId,
  project,
  doctor,
  projectAgents,
  lastSync,
  openPrTotal,
  dataVersion,
  setOpenPrTotal,
  setError,
  setNotice,
});

async function load() {
  const initial = beginLoad();
  error.value = "";
  try {
    project.value = await getProject(projectId.value);
    doctor.value = await getProjectDoctor(projectId.value);
    const agents = await listAgents({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: projectId.value,
    });
    projectAgents.value = agents.items;
    dataVersion.value += 1;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load project";
    if (initial) {
      project.value = null;
      doctor.value = null;
      projectAgents.value = [];
    }
  } finally {
    endLoad(initial);
  }
}

async function runSync() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await syncProject(project.value.id);
    project.value = result.project;
    lastSync.value = result.sync;
    const path = result.sync.manifestPath
      ? result.sync.manifestPath.split(/[/\\]/).slice(-2).join("/")
      : "no manifest file";
    notice.value = `Synced from ${path} — ${result.sync.profiles} profiles, ${result.sync.agents} agents, ${result.sync.schedules} schedules`;
    doctor.value = await getProjectDoctor(project.value.id);
    const agents = await listAgents({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: project.value.id,
    });
    projectAgents.value = agents.items;
    dataVersion.value += 1;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    busy.value = false;
  }
}

async function toggleEnabled() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    project.value = project.value.enabled
      ? await disableProject(project.value.id)
      : await enableProject(project.value.id);
    notice.value = project.value.enabled
      ? "Project enabled (runtime). Next Sync reapplies gojo.yaml if it disagrees."
      : "Project disabled (runtime). Schedules and triggers stay off until enable or Sync.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update project";
  } finally {
    busy.value = false;
  }
}

async function confirmRemove() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await deleteProject(project.value.id);
    removeOpen.value = false;
    await router.push({ name: "projects" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Remove failed";
    busy.value = false;
  }
}

watch(projectId, () => {
  resetLoad();
  project.value = null;
  doctor.value = null;
  projectAgents.value = [];
  lastSync.value = null;
  openPrTotal.value = 0;
  notice.value = "";
  void load();
});

const catalogStore = useCatalogStore();
bindStoreRefresh(catalogStore, load);
</script>

<template>
  <div>
    <PageHeader
      :title="project?.name ?? 'Project'"
      :back-to="{ name: 'projects' }"
      back-label="Projects"
    >
      <template #subtitle>
        <div v-if="project" class="subtitle mono">{{ project.id }}</div>
      </template>
      <template #actions>
        <AppButton
          variant="primary"
          size="sm"
          :icon="RefreshCw"
          :loading="busy"
          loading-label="Syncing…"
          :disabled="!project"
          @click="runSync()"
        >
          Sync
        </AppButton>
        <AppButton
          size="sm"
          :icon="Power"
          :loading="busy"
          loading-label="Working…"
          :disabled="!project"
          :title="
            project
              ? 'Runtime toggle — lasts until the next Sync if the manifest disagrees'
              : undefined
          "
          @click="toggleEnabled()"
        >
          {{ project?.enabled === false ? "Enable" : "Disable" }}
        </AppButton>
        <AppButton
          variant="danger"
          size="sm"
          :icon="Trash2"
          :disabled="busy || !project"
          @click="removeOpen = true"
        >
          Remove
        </AppButton>
      </template>
    </PageHeader>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" class="alert alert-success">{{ notice }}</div>

    <div v-if="loading && !project" class="empty">Loading…</div>
    <template v-else-if="project">
      <ProjectSubnav :items="subnavItems" />
      <RouterView />
    </template>

    <ConfirmDialog
      :open="removeOpen"
      title="Remove project?"
      confirm-label="Remove project"
      danger
      :busy="busy"
      @close="removeOpen = false"
      @confirm="confirmRemove"
    >
      <p>
        Unregister <strong>{{ project?.name }}</strong> from gojo. Scheduled work for this project
        stops, and gojo’s local history for it is removed.
      </p>
      <p class="muted mt-3">
        This does <strong>not</strong> delete the git repository at
        <span class="mono">{{ project?.repoPath }}</span>.
      </p>
    </ConfirmDialog>
  </div>
</template>
