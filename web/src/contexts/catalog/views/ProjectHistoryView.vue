<script setup lang="ts">
import { inject } from "vue";

import { projectShellKey } from "@/contexts/catalog/project-shell";
import ProjectHistoryPanel from "@/contexts/work/components/ProjectHistoryPanel.vue";

const shell = inject(projectShellKey);
if (!shell) {
  throw new Error("ProjectHistoryView requires ProjectShellView");
}

const { projectId } = shell;
</script>

<template>
  <ProjectHistoryPanel :project-id="projectId" />
</template>
