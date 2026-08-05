<script setup lang="ts">
import { inject } from "vue";

import ProjectImpactSection from "@/contexts/catalog/components/ProjectImpactSection.vue";
import { projectShellKey } from "@/contexts/catalog/project-shell";

const shell = inject(projectShellKey);
if (!shell) {
  throw new Error("ProjectImpactPageView requires ProjectShellView");
}

const { projectId, openPrTotal } = shell;
</script>

<template>
  <ProjectImpactSection mode="full" :project-id="projectId" :open-pr-total="openPrTotal" />
</template>
