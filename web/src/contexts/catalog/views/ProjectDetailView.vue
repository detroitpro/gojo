<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import ProjectImpactSection from "@/contexts/catalog/components/ProjectImpactSection.vue";
import {
  deleteProject,
  disableProject,
  enableProject,
  getProject,
  listAgents,
  syncProject,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { getProjectDoctor } from "@/contexts/operations/contract";
import ProjectWorkPanel from "@/contexts/work/components/ProjectWorkPanel.vue";
import AppButton from "@/ui/AppButton.vue";
import PageHeader from "@/ui/PageHeader.vue";
import ConfirmDialog from "@/ui/ConfirmDialog.vue";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import { useSoftLoading } from "@/platform/useSoftLoading";
import EnabledBadge from "@/ui/status/EnabledBadge.vue";
import HealthBadge from "@/ui/status/HealthBadge.vue";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import { computeProjectHealth, parseManifestView } from "@/kernel/project-manifest";
import { Calendar, ListTodo, Play, Power, RefreshCw, Trash2 } from "lucide-vue-next";
import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import type { ProjectDoctorResult } from "@/contexts/operations/types";

const route = useRoute();
const router = useRouter();

const project = ref<Project | null>(null);
const doctor = ref<ProjectDoctorResult | null>(null);
const lastSync = ref<ProjectSyncResult | null>(null);
const projectAgents = ref<Agent[]>([]);
const openPrTotal = ref(0);
const workPanel = ref<InstanceType<typeof ProjectWorkPanel> | null>(null);
const { loading, begin: beginLoad, end: endLoad, reset: resetLoad } = useSoftLoading();
const busy = ref(false);
const error = ref("");
const notice = ref("");
const removeOpen = ref(false);

const projectId = computed(() => route.params.id as string);

const manifest = computed(() => parseManifestView(project.value?.manifestJson));

const health = computed(() =>
  project.value
    ? computeProjectHealth(project.value, doctor.value)
    : { score: null, level: "missing" as const, label: "…" },
);

// Optional at runtime: the UI can be newer than the daemon serving /doctor.
const workspaceFiles = computed(() => doctor.value?.workspaceFiles ?? null);

const workspaceFilesOk = computed(() => {
  const files = workspaceFiles.value;
  if (!files) {
    return true;
  }
  return (
    files.trackedGeneratedFiles.length === 0 && files.unignoredGeneratedFiles.length === 0
  );
});

const agentsByName = computed(() => {
  const map = new Map<string, Agent>();
  for (const agent of projectAgents.value) {
    map.set(agent.name, agent);
  }
  return map;
});

const mergeBabysitter = computed(() =>
  projectAgents.value.find((agent) => agent.name === "maintain-merge" && agent.enabled) ?? null,
);

function scrollToOpenPrs() {
  document.getElementById("delivery")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load project";
    if (initial) {
      project.value = null;
      doctor.value = null;
      projectAgents.value = [];
    }
  } finally {
    endLoad(initial);
    if (route.hash === "#open-prs") {
      requestAnimationFrame(() => scrollToOpenPrs());
    }
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
    await workPanel.value?.loadWork();
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
  notice.value = "";
  void load();
});

watch(
  () => route.hash,
  (hash) => {
    if (hash === "#open-prs" && !loading.value) {
      requestAnimationFrame(() => scrollToOpenPrs());
    }
  },
);

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
      <section class="panel mb-7">
        <div class="panel-header">
          Overview
          <HealthBadge :level="health.level" :label="health.label" />
        </div>
        <div class="panel-body">
          <dl class="project-meta">
            <div>
              <dt>Status</dt>
              <dd>
                <EnabledBadge :enabled="project.enabled !== false" />
                <span v-if="project.enabled === false" class="muted text-sm">
                  — new scheduled, work, and API runs are blocked
                </span>
              </dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd class="mono">{{ project.repoPath }}</dd>
            </div>
            <div v-if="project.remoteUrl">
              <dt>Remote</dt>
              <dd>
                <a
                  :href="project.remoteUrl"
                  class="entity-name"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ project.remoteUrl }}
                </a>
              </dd>
            </div>
            <div>
              <dt>Default branch</dt>
              <dd class="mono">{{ project.defaultBranch }}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>
                {{ project.enabledAgentCount }}/{{ project.agentCount }} agents ·
                {{ project.enabledScheduleCount }}/{{ project.scheduleCount }} schedules
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd class="mono">{{ new Date(project.updatedAt).toLocaleString() }}</dd>
            </div>
          </dl>

          <div class="toolbar mt-5">
            <AppButton
              size="sm"
              :icon="ListTodo"
              :to="{ name: 'agents', query: { projectId: project.id } }"
            >
              Agents
            </AppButton>
            <AppButton
              size="sm"
              :icon="Calendar"
              :to="{ name: 'schedules', query: { projectId: project.id } }"
            >
              Schedules
            </AppButton>
            <AppButton
              size="sm"
              :icon="Play"
              :to="{ name: 'runs', query: { projectId: project.id } }"
            >
              Runs
            </AppButton>
          </div>
        </div>
      </section>

      <ProjectWorkPanel
        ref="workPanel"
        :project-id="projectId"
        :merge-babysitter="mergeBabysitter"
        @error="error = $event"
        @notice="notice = $event"
        @open-pr-total="openPrTotal = $event"
      />

      <ProjectImpactSection :project-id="projectId" :open-pr-total="openPrTotal" />

      <section class="panel mb-7">
        <div class="panel-header">Sync</div>
        <div class="panel-body">
          <p class="muted">
            Sync reads <span class="mono">gojo.yaml</span> (or
            <span class="mono">.gojo/project.yaml</span>) and upserts profiles, agents, and
            schedules by name. Entries removed from the manifest are soft-disabled so they stop
            firing. Sync does not change git history or your working tree.
          </p>
          <div v-if="lastSync" class="mt-5 project-sync-result">
            <div>
              Manifest:
              <span class="mono">{{ lastSync.manifestPath ?? "not found" }}</span>
            </div>
            <div class="muted mt-2">
              {{ lastSync.profiles }} profiles · {{ lastSync.agents }} agents ·
              {{ lastSync.schedules }} schedules
            </div>
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Health</div>
        <div class="panel-body">
          <div v-if="!doctor" class="muted">Doctor results unavailable.</div>
          <ul v-else class="health-checklist">
            <li>
              <span :class="doctor.repoExists ? 'ok' : 'bad'">●</span>
              Repository path {{ doctor.repoExists ? "exists" : "is missing" }}
            </li>
            <li>
              <span :class="doctor.manifest ? 'ok' : 'bad'">●</span>
              Manifest file {{ doctor.manifest ? "found" : "not found" }}
            </li>
            <li>
              <span :class="doctor.baseCheckout.clean ? 'ok' : 'bad'">●</span>
              Base checkout
              {{ doctor.baseCheckout.clean ? "is clean" : "has local changes" }}
              <span v-if="doctor.baseCheckout.behindOrigin != null" class="muted">
                · {{ doctor.baseCheckout.behindOrigin }} commit(s) behind origin
              </span>
              <ul
                v-if="doctor.baseCheckout.dirtyFiles.length"
                class="muted mt-2 health-dirty-files"
              >
                <li
                  v-for="file in doctor.baseCheckout.dirtyFiles.slice(0, 12)"
                  :key="file"
                  class="mono"
                >
                  {{ file }}
                </li>
                <li v-if="doctor.baseCheckout.dirtyFiles.length > 12">
                  … +{{ doctor.baseCheckout.dirtyFiles.length - 12 }} more
                </li>
              </ul>
            </li>
            <li v-if="workspaceFiles">
              <span :class="workspaceFilesOk ? 'ok' : 'bad'">●</span>
              Generated <span class="mono">.gojo</span> run files
              {{ workspaceFilesOk ? "are ignored by git" : "are tracked or unignored" }}
              <ul v-if="!workspaceFilesOk" class="muted mt-2 health-dirty-files">
                <li
                  v-for="file in workspaceFiles.trackedGeneratedFiles"
                  :key="`tracked:${file}`"
                  class="mono"
                >
                  {{ file }} — committed to the repo
                </li>
                <li
                  v-for="file in workspaceFiles.unignoredGeneratedFiles"
                  :key="`unignored:${file}`"
                  class="mono"
                >
                  {{ file }} — not covered by .gitignore
                </li>
              </ul>
              <pre
                v-if="workspaceFiles.suggestedGitignore"
                class="mono mt-2 gitignore-suggestion"
              >{{ workspaceFiles.suggestedGitignore }}</pre>
            </li>
            <li v-if="workspaceFiles?.untrackedRegistrationFiles.length">
              <span class="bad">●</span>
              Registration files not tracked by git
              <ul class="muted mt-2 health-dirty-files">
                <li
                  v-for="file in workspaceFiles.untrackedRegistrationFiles"
                  :key="`registration:${file}`"
                  class="mono"
                >
                  {{ file }}
                </li>
              </ul>
            </li>
            <li v-for="tool in doctor.validationTools" :key="`${tool.agent}:${tool.step}:${tool.binary}`">
              <span :class="tool.found ? 'ok' : 'bad'">●</span>
              Validation tool <span class="mono">{{ tool.binary }}</span>
              <template v-if="tool.shellBuiltin"> (shell builtin — ok)</template>
              <template v-else-if="tool.found"> found on daemon PATH</template>
              <template v-else> missing under daemon PATH</template>
              <span class="muted"> — {{ tool.agent }} / {{ tool.step }}</span>
            </li>
            <li v-if="doctor.validationTools.length === 0" class="muted">
              No validation tool checks reported
            </li>
          </ul>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Configuration</div>
        <div class="panel-body">
          <div v-if="!project.hasManifest" class="muted">
            No synced manifest yet. Run Sync after adding a
            <span class="mono">gojo.yaml</span>.
          </div>
          <template v-else-if="!manifest.ok">
            <div class="alert alert-error">Could not parse manifest: {{ manifest.error }}</div>
          </template>
          <template v-else>
            <div v-if="Object.keys(manifest.repository).length" class="mb-7">
              <div class="panel-subheader">Repository</div>
              <ul class="project-kv">
                <li v-for="(value, key) in manifest.repository" :key="key">
                  <span class="mono">{{ key }}</span>
                  <span class="muted">{{ String(value) }}</span>
                </li>
              </ul>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Profiles ({{ manifest.profiles.length }})</div>
              <div v-if="manifest.profiles.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Adapter</th>
                      <th>Model</th>
                      <th>Timeout</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="profile in manifest.profiles" :key="profile.name">
                      <td class="entity-name">{{ profile.name }}</td>
                      <td class="mono">{{ profile.adapter }}</td>
                      <td class="mono muted">{{ profile.model ?? "—" }}</td>
                      <td class="mono muted">{{ profile.timeout ?? "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Agents ({{ manifest.agents.length }})</div>
              <div v-if="manifest.agents.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Profile</th>
                      <th>Integration</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="agent in manifest.agents" :key="agent.name">
                      <td>
                        <RouterLink
                          v-if="agentsByName.get(agent.name)"
                          :to="{
                            name: 'agent-detail',
                            params: { id: agentsByName.get(agent.name)!.id },
                          }"
                          class="entity-name"
                        >
                          {{ agent.name }}
                        </RouterLink>
                        <span v-else class="entity-name">{{ agent.name }}</span>
                      </td>
                      <td class="mono">{{ agent.profile }}</td>
                      <td class="mono">{{ agent.integrationMode }}</td>
                      <td class="muted">{{ agent.description || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Schedules ({{ manifest.schedules.length }})</div>
              <div v-if="manifest.schedules.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Agent</th>
                      <th>Cron</th>
                      <th>Timezone</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="schedule in manifest.schedules" :key="schedule.name">
                      <td class="entity-name">{{ schedule.name }}</td>
                      <td class="mono">{{ schedule.agent }}</td>
                      <td class="mono">{{ schedule.cron }}</td>
                      <td class="mono muted">{{ schedule.timezone }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">
                Validation profiles ({{ manifest.validationProfiles.length }})
              </div>
              <div v-if="manifest.validationProfiles.length === 0" class="muted">None</div>
              <ul v-else class="project-kv">
                <li v-for="profile in manifest.validationProfiles" :key="profile.name">
                  <span class="mono">{{ profile.name }}</span>
                  <span class="muted">{{ profile.stepCount }} steps</span>
                </li>
              </ul>
            </div>

            <details class="project-raw-json">
              <summary class="muted">Advanced: raw JSON</summary>
              <pre class="pre-block">{{ manifest.prettyJson }}</pre>
            </details>
          </template>
        </div>
      </section>
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
