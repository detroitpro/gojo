<script setup lang="ts">
import { inject } from "vue";

import ProjectHealthPanel from "@/contexts/catalog/components/ProjectHealthPanel.vue";
import { projectShellKey } from "@/contexts/catalog/project-shell";

const shell = inject(projectShellKey);
if (!shell) {
  throw new Error("ProjectHealthView requires ProjectShellView");
}

const { project, doctor } = shell;
</script>

<template>
  <ProjectHealthPanel v-if="project" :project="project" :doctor="doctor" />
</template>
