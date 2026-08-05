<script setup lang="ts">
import { inject } from "vue";

import ProjectConfigurationPanel from "@/contexts/catalog/components/ProjectConfigurationPanel.vue";
import { projectShellKey } from "@/contexts/catalog/project-shell";

const shell = inject(projectShellKey);
if (!shell) {
  throw new Error("ProjectConfigurationView requires ProjectShellView");
}

const { project, projectAgents, lastSync } = shell;
</script>

<template>
  <ProjectConfigurationPanel
    v-if="project"
    :project="project"
    :agents="projectAgents"
    :last-sync="lastSync"
  />
</template>
