<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { Calendar, ListTodo, Play } from "lucide-vue-next";

import ProjectImpactSection from "@/contexts/catalog/components/ProjectImpactSection.vue";
import { projectShellKey } from "@/contexts/catalog/project-shell";
import ProjectWorkPanel from "@/contexts/work/components/ProjectWorkPanel.vue";
import { computeProjectHealth } from "@/kernel/project-manifest";
import AppButton from "@/ui/AppButton.vue";
import EnabledBadge from "@/ui/status/EnabledBadge.vue";
import HealthBadge from "@/ui/status/HealthBadge.vue";

const shell = inject(projectShellKey);
if (!shell) {
  throw new Error("ProjectOverviewView requires ProjectShellView");
}

const route = useRoute();
const workPanel = ref<InstanceType<typeof ProjectWorkPanel> | null>(null);

const { project, doctor, projectId, openPrTotal, dataVersion } = shell;

const health = computed(() =>
  project.value
    ? computeProjectHealth(project.value, doctor.value)
    : { score: null, level: "missing" as const, label: "…" },
);

const mergeBabysitter = computed(
  () =>
    shell.projectAgents.value.find(
      (agent) => agent.name === "maintain-merge" && agent.enabled,
    ) ?? null,
);

function scrollToDelivery() {
  document.getElementById("delivery")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

watch(dataVersion, () => {
  const panel = workPanel.value as { loadWork?: () => Promise<void> } | null;
  if (typeof panel?.loadWork === "function") {
    void panel.loadWork();
  }
});

watch(
  () => route.hash,
  (hash) => {
    if (hash === "#delivery" || hash === "#open-prs") {
      requestAnimationFrame(() => scrollToDelivery());
    }
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="project">
    <section class="panel mb-7">
      <div class="panel-header">
        Overview
        <RouterLink
          :to="{ name: 'project-health', params: { id: project.id } }"
          class="health-badge-link"
        >
          <HealthBadge :level="health.level" :label="health.label" />
        </RouterLink>
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
      @error="shell.setError($event)"
      @notice="shell.setNotice($event)"
      @open-pr-total="shell.setOpenPrTotal($event)"
    />

    <ProjectImpactSection
      mode="compact"
      :project-id="projectId"
      :open-pr-total="openPrTotal"
    />
  </template>
</template>

<style scoped>
.health-badge-link {
  text-decoration: none;
  color: inherit;
}

.health-badge-link:hover {
  opacity: 0.9;
}
</style>
