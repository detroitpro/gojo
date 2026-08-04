<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import { RouterLink } from "vue-router";

/**
 * Standard page header used at the top of every routed view.
 *
 * Renders the shared `.page-header` chrome (title + optional subtitle + optional
 * back link) on the left and an optional actions toolbar on the right. Keeping
 * this in one component means the desktop band height and the mobile responsive
 * rules live in exactly one place instead of being re-implemented per view.
 */
defineProps<{
  title?: string;
  subtitle?: string;
  backTo?: RouteLocationRaw;
  backLabel?: string;
}>();
</script>

<template>
  <header class="page-header">
    <div class="page-header__lead">
      <RouterLink
        v-if="backTo != null"
        :to="backTo"
        class="muted text-sm page-header__back"
      >
        ← {{ backLabel ?? "Back" }}
      </RouterLink>
      <slot name="title">
        <h1 :class="{ 'mt-2': backTo != null }">{{ title }}</h1>
      </slot>
      <slot name="subtitle">
        <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
      </slot>
    </div>
    <div v-if="$slots.actions" class="toolbar">
      <slot name="actions" />
    </div>
  </header>
</template>
