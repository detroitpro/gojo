<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import type { Project } from "@/contexts/catalog/types";
import type { ProjectDoctorResult } from "@/contexts/operations/types";
import {
  computeProjectHealth,
  projectHealthFactors,
} from "@/kernel/project-manifest";
import HealthBadge from "@/ui/status/HealthBadge.vue";

const props = defineProps<{
  project: Project;
  doctor: ProjectDoctorResult | null;
}>();

const health = computed(() => computeProjectHealth(props.project, props.doctor));

const workspaceFiles = computed(() => props.doctor?.workspaceFiles ?? null);

const factors = computed(() =>
  projectHealthFactors(props.project, props.doctor, {
    workspaceFiles: workspaceFiles.value,
  }),
);

const scoredFactors = computed(() => factors.value.filter((factor) => factor.scored));
const infoFactors = computed(() => factors.value.filter((factor) => !factor.scored));
</script>

<template>
  <section class="panel mb-7">
    <div class="panel-header">
      Health
      <HealthBadge :level="health.level" :label="health.label" />
    </div>
    <div class="panel-body">
      <p class="muted">
        Score is 0–100 from project doctor checks on the registered base checkout (not a
        percentage). Fix failing scored factors below, then refresh this page.
      </p>

      <div v-if="!doctor" class="muted mt-5">Doctor results unavailable.</div>
      <template v-else>
        <div class="mt-5">
          <div class="panel-subheader">Score factors</div>
          <ul class="health-checklist">
            <li v-for="factor in scoredFactors" :key="factor.id">
              <span :class="factor.ok ? 'ok' : 'bad'">●</span>
              {{ factor.label }}
              <span v-if="!factor.ok && factor.penalty > 0" class="muted">
                · −{{ factor.penalty }}
              </span>
              <p v-if="factor.remediation" class="muted text-sm mt-2">
                {{ factor.remediation }}
              </p>
              <ul
                v-if="factor.details?.length"
                class="muted mt-2 health-dirty-files"
              >
                <li
                  v-for="detail in factor.details.slice(0, 12)"
                  :key="detail"
                  class="mono"
                >
                  {{ detail }}
                </li>
                <li v-if="factor.details.length > 12">
                  … +{{ factor.details.length - 12 }} more
                </li>
              </ul>
            </li>
          </ul>
        </div>

        <div v-if="infoFactors.length" class="mt-7">
          <div class="panel-subheader">Also checked (not in score)</div>
          <ul class="health-checklist">
            <li v-for="factor in infoFactors" :key="factor.id">
              <span :class="factor.ok ? 'ok' : 'bad'">●</span>
              {{ factor.label }}
              <p v-if="factor.remediation" class="muted text-sm mt-2">
                {{ factor.remediation }}
              </p>
              <ul
                v-if="factor.details?.length"
                class="muted mt-2 health-dirty-files"
              >
                <li
                  v-for="detail in factor.details"
                  :key="detail"
                  class="mono"
                >
                  {{ detail }}
                </li>
              </ul>
              <pre
                v-if="
                  factor.id === 'workspace-generated' &&
                  workspaceFiles?.suggestedGitignore
                "
                class="mono mt-2 gitignore-suggestion"
              >{{ workspaceFiles.suggestedGitignore }}</pre>
            </li>
          </ul>
        </div>

        <p class="muted text-sm mt-5">
          CLI:
          <span class="mono">gojo project doctor {{ project.id }}</span>
          ·
          <RouterLink
            :to="{ name: 'project-configuration', params: { id: project.id } }"
            class="entity-name"
          >
            Configuration
          </RouterLink>
          for sync and manifest.
        </p>
      </template>
    </div>
  </section>
</template>
